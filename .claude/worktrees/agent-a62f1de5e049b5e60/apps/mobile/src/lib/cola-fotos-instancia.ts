import type { TipoFoto } from "@market-track/shared";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import { useEffect, useState } from "react";

import {
  type AlmacenManifiesto,
  ColaFotos,
  type FotoPendiente,
} from "./cola-fotos";
import type { FotoCapturada } from "./foto-captura";
import { puntoAEwkt } from "./geo";
import { db } from "./powersync/db";
import { contarPendientes } from "./powersync/estado";
import { ErrorFirmado, SubidorFotos } from "./subidor-fotos";
import { supabase } from "./supabase";

// La cola de fotos de la app, su instancia y el subidor que la vacía.
//
// El manifiesto vive en el directorio de DOCUMENTOS, no en el de caché: una foto
// encolada sin señal tiene que seguir ahí tras cerrar la app (el offline real es
// el diferenciador #1). Por la misma razón el binario se mueve ahí al encolarlo:
// `manipulateAsync` lo deja en caché, y Android purga la caché bajo presión de
// almacenamiento — una foto tomada en un sótano y subida tres días después puede
// no tener archivo.

const RUTA_MANIFIESTO = `${FileSystem.documentDirectory}cola-fotos.json`;
const DIR_FOTOS = `${FileSystem.documentDirectory}fotos`;
const TEMPORAL = `${RUTA_MANIFIESTO}.tmp`;

const almacenDisco: AlmacenManifiesto = {
  async leer() {
    const info = await FileSystem.getInfoAsync(RUTA_MANIFIESTO);
    if (!info.exists) return null;
    return FileSystem.readAsStringAsync(RUTA_MANIFIESTO);
  },
  async escribir(contenido) {
    // Se escribe a un temporal y se renombra: un corte de batería a mitad de la
    // escritura dejaría el manifiesto truncado, y con él la cola entera perdida.
    // El renombrado es la operación que el sistema de archivos sí hace atómica.
    await FileSystem.writeAsStringAsync(TEMPORAL, contenido);
    await FileSystem.moveAsync({ from: TEMPORAL, to: RUTA_MANIFIESTO });
  },
};

export const colaFotos = new ColaFotos(almacenDisco);

/** La ruta local de una foto, DERIVADA de su id: así se puede reencontrar. */
export function rutaDeFoto(fotoId: string): string {
  return `${DIR_FOTOS}/${fotoId}.jpg`;
}

// El id del usuario con sesión. El subidor lo consulta en cada pasada y
// `auth.getUser()` es asíncrono, así que lo fija el shell al iniciar sesión.
let usuarioActual: string | null = null;

export function fijarUsuarioDeFotos(id: string | null): void {
  usuarioActual = id;
}

/**
 * Borra la cola y los binarios del mercaderista anterior.
 *
 * Se llama junto a `disconnectAndClear()`: si la réplica del otro usuario se
 * limpia pero sus fotos se quedan, este teléfono conserva evidencia de campo
 * —con geo y hora— de alguien que ya no debería tener contexto aquí. La
 * revocación tiene que alcanzar también a lo capturado, no solo a lo leído.
 */
export async function limpiarFotosDelDispositivo(): Promise<void> {
  await FileSystem.deleteAsync(DIR_FOTOS, { idempotent: true });
  await FileSystem.deleteAsync(RUTA_MANIFIESTO, { idempotent: true });
}

/** Pide la URL PUT prefirmada a la Edge Function. */
async function firmarSubida(visitaId: string, fotoId: string) {
  const respuesta = await supabase.functions.invoke<{ url: string }>(
    "fotos-subida-firmada",
    {
      body: { visita_id: visitaId, foto_id: fotoId },
    },
  );
  // El SDK tipa `error` como `any`: anotarlo `unknown` corta el contagio en el
  // borde en vez de dejarlo propagarse.
  const fallo: unknown = respuesta.error;
  if (fallo) {
    // El status viene en el contexto del error del SDK. Sin él se asume 0, que se
    // clasifica como transitorio: el lado seguro, porque no descarta nada.
    const contexto =
      typeof fallo === "object" && fallo !== null && "context" in fallo
        ? (fallo as { context?: { status?: number } }).context
        : undefined;
    throw new ErrorFirmado(Number(contexto?.status) || 0);
  }
  const data = respuesta.data;
  if (!data?.url) throw new ErrorFirmado(0);
  return data.url;
}

export const subidorFotos = new SubidorFotos({
  cola: colaFotos,
  firmar: firmarSubida,
  async subirBinario(url, ruta) {
    // `uploadAsync` transmite DESDE DISCO: el JPEG no se carga en memoria ni pasa
    // por base64. En un Android de gama media eso importa.
    const r = await FileSystem.uploadAsync(url, ruta, {
      httpMethod: "PUT",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    });
    return { estado: r.status };
  },
  archivo: {
    async existe(ruta) {
      return (await FileSystem.getInfoAsync(ruta)).exists;
    },
    async borrar(ruta) {
      await FileSystem.deleteAsync(ruta, { idempotent: true });
    },
  },
  replica: {
    async yaSubida(fotoId) {
      const fila = await db.getOptional<{ subida_at: string | null }>(
        `SELECT subida_at FROM foto WHERE id = ?`,
        [fotoId],
      );
      return Boolean(fila?.subida_at);
    },
    async marcarSubida(fotoId, subidaAt) {
      await db.execute(`UPDATE foto SET subida_at = ? WHERE id = ?`, [
        subidaAt,
        fotoId,
      ]);
    },
  },
  entorno: {
    conectado: () => db.currentStatus.connected,
    registrosPendientes: contarPendientes,
    usuarioId: () => usuarioActual,
    ahora: () => Date.now(),
  },
});

export type DatosFoto = {
  /** Lo que entrega la cámara: archivo, hash, hora y geo de captura. */
  foto: FotoCapturada;
  tenantId: string;
  visitaId: string;
  levantamientoId: string | null;
  tipo: TipoFoto;
  /** Solo si quien llama necesita conocerlo antes (la contingencia lo referencia). */
  id?: string;
};

/**
 * Encola una foto recién capturada. Único dueño de los tres pasos, en este orden:
 *
 *   1. mover el binario a una ruta DERIVADA del id, en documentos
 *   2. escribir la fila `foto` en la réplica (sube por el sync)
 *   3. añadir la entrada al manifiesto
 *
 * El orden importa: si el proceso muere entre el 1 y el 3, `reconciliarFotos`
 * reencuentra el archivo porque su ruta se deduce del id de la fila.
 */
export async function encolarFoto(d: DatosFoto): Promise<string> {
  // El dueño sale de la VISITA, no de un parámetro ni del usuario cacheado: es el
  // mismo criterio que usa la política de INSERT de `foto` y el firmado de la
  // Edge Function, así que no puede desviarse de ellos.
  const visita = await db.getOptional<{ mercaderista_id: string }>(
    `SELECT mercaderista_id FROM visita WHERE id = ?`,
    [d.visitaId],
  );
  if (!visita) {
    throw new Error(
      `No se puede encolar la foto: la visita ${d.visitaId} no está en la réplica`,
    );
  }

  const id = d.id ?? Crypto.randomUUID();
  await FileSystem.makeDirectoryAsync(DIR_FOTOS, { intermediates: true });
  const destino = rutaDeFoto(id);
  if (d.foto.ruta !== destino) {
    await FileSystem.moveAsync({ from: d.foto.ruta, to: destino });
  }

  await db.execute(
    `INSERT INTO foto
       (id, tenant_id, visita_id, levantamiento_id, tipo, hash, capturada_at, geo, subida_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      id,
      d.tenantId,
      d.visitaId,
      d.levantamientoId,
      d.tipo,
      d.foto.hash,
      d.foto.capturada_at,
      d.foto.geo ? puntoAEwkt(d.foto.geo) : null,
    ],
  );

  await colaFotos.encolar({
    id,
    ruta: destino,
    hash: d.foto.hash,
    visita_id: d.visitaId,
    mercaderista_id: visita.mercaderista_id,
    encolada_at: new Date().toISOString(),
    intentos: 0,
    proximo_intento_at: null,
    requiere_atencion: false,
  });

  // Si hay señal, sube ya. SIN await: el paso del wizard no espera a la red, y el
  // check-out tampoco.
  void subidorFotos.arrancar();
  return id;
}

/**
 * Re-encola lo que quedó a medias: filas sin `subida_at` cuyo archivo sigue en
 * disco pero que no están en el manifiesto. Es la red contra un manifiesto
 * truncado o una app muerta entre los pasos 1 y 3 de `encolarFoto`.
 */
export async function reconciliarFotos(
  mercaderistaId: string,
): Promise<number> {
  // El dueño sale del JOIN con `visita`, igual que en `encolarFoto`. Estampar el
  // usuario actual sobre lo que se reencuentra anularía el filtro del subidor: en
  // un teléfono compartido, una foto huérfana del turno anterior volvería a la
  // cola a nombre de quien esté usándolo ahora.
  const filas = await db.getAll<{
    id: string;
    visita_id: string;
    hash: string | null;
    capturada_at: string;
  }>(
    `SELECT f.id, f.visita_id, f.hash, f.capturada_at
     FROM foto f
     JOIN visita v ON v.id = f.visita_id
     WHERE f.subida_at IS NULL AND v.mercaderista_id = ?`,
    [mercaderistaId],
  );

  const enCola = new Set((await colaFotos.listarPendientes()).map((f) => f.id));

  let reencoladas = 0;
  for (const fila of filas) {
    if (enCola.has(fila.id)) continue;
    const ruta = rutaDeFoto(fila.id);
    if (!(await FileSystem.getInfoAsync(ruta)).exists) continue;
    await colaFotos.encolar({
      id: fila.id,
      ruta,
      hash: fila.hash ?? "",
      visita_id: fila.visita_id,
      mercaderista_id: mercaderistaId,
      encolada_at: fila.capturada_at,
      intentos: 0,
      proximo_intento_at: null,
      requiere_atencion: false,
    });
    reencoladas += 1;
  }
  if (reencoladas > 0) {
    console.warn(`Reconciliación de fotos: ${reencoladas} re-encolada(s)`);
  }
  return reencoladas;
}

/** El número de fotos pendientes de subir, reactivo. Para el indicador. */
export function useCountFotos(): number {
  const [n, setN] = useState(0);

  useEffect(() => {
    let vivo = true;
    void colaFotos.contarPendientes().then((c) => vivo && setN(c));
    const quitar = colaFotos.suscribir((total) => vivo && setN(total));
    return () => {
      vivo = false;
      quitar();
    };
  }, []);

  return n;
}

/** La lista de fotos pendientes, reactiva. Para la pantalla de sincronización. */
export function useFotosPendientes(): FotoPendiente[] {
  const [fotos, setFotos] = useState<FotoPendiente[]>([]);

  useEffect(() => {
    let vivo = true;
    const refrescar = () =>
      void colaFotos.listarPendientes().then((f) => vivo && setFotos(f));
    refrescar();
    const quitar = colaFotos.suscribir(() => refrescar());
    return () => {
      vivo = false;
      quitar();
    };
  }, []);

  return fotos;
}
