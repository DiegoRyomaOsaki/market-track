import { useQuery } from "@powersync/react-native";
import * as FileSystem from "expo-file-system/legacy";

// Las paradas que el supervisor quitó de la ruta, para que no desaparezcan en
// silencio.
//
// PowerSync borra la fila de `rutero_parada` de la réplica sin decir nada. Lo
// que el mercaderista concluye de una tienda que se le esfuma de la lista no es
// "me la quitaron": es que la app se equivocó, y esa es la única herramienta que
// tiene en campo. Esto le da el otro dato: qué tienda, cuándo y por qué.
//
// Solo lectura y cero red, como todo flujo de campo: la baja viaja en la MISMA
// transacción que la escribe (`quitar_parada_rutero`), así que llega al teléfono
// en el mismo checkpoint que borra la parada. Sin señal, se lee lo último
// replicado igual que el resto de la pantalla.
//
// ---------------------------------------------------------------------------
// El aviso es PERSISTENTE hasta que el mercaderista lo descarta, no efímero.
//
// Un banner que se va solo se gasta con el teléfono en el bolsillo, que es justo
// el caso que más importa: la baja llega cuando el mercaderista recupera
// cobertura, a mitad de jornada, mientras trabaja dentro de una tienda. Un aviso
// que ya nadie puede leer es indistinguible de no haber avisado.
//
// El descarte se guarda EN DISCO y POR DÍA, no se sincroniza: es estado de UI de
// este dispositivo, y sincronizarlo pediría schema nuevo y una política de
// escritura sobre una tabla de auditoría que hoy no puede escribir nadie desde
// la app. Por día porque el aviso vive el día de la ruta a la que pertenecía:
// una tienda que ya no es tuya deja de importar cuando el día acaba —a
// diferencia de un reporte rechazado, que sigue siendo accionable una semana
// después (ver `DIAS_DE_RECHAZOS_VISIBLES` en revision.ts).
//
// Lo que este aviso NO puede cubrir: si el teléfono pasa horas sin señal, la
// parada sigue visible y el mercaderista puede viajar a una tienda que ya no es
// suya. No hay nada que contar mientras no se sepa. Cuando vuelve la cobertura,
// el borrado y el aviso llegan juntos.
// ---------------------------------------------------------------------------

export type RetiradaLocal = {
  id: string;
  tienda_id: string;
  fecha: string;
  retirada_at: string;
  motivo: string | null;
  /** Null si la tienda no está en la réplica: el aviso NO se calla por eso. */
  tienda_nombre: string | null;
};

export type AvisoDeRetiro = {
  /** El id de la fila de auditoría. Es la clave del descarte. */
  id: string;
  tienda: string;
  /** ISO; la UI lo formatea en la zona de Lima. */
  retirada_at: string;
  motivo: string | null;
};

/** Lo que se enseña cuando la tienda no está en la réplica. */
const TIENDA_SIN_NOMBRE = "Una tienda de tu ruta";

// `LEFT JOIN` a propósito: con un `JOIN` normal, una tienda que faltara en la
// réplica haría desaparecer el aviso — exactamente la desaparición silenciosa
// que este módulo existe para combatir.
const SQL = `
  SELECT rr.id, rr.tienda_id, rr.fecha, rr.retirada_at, rr.motivo,
         t.nombre AS tienda_nombre
  FROM rutero_parada_retirada rr
  LEFT JOIN tienda t ON t.id = rr.tienda_id
  WHERE rr.fecha = ?
  ORDER BY rr.retirada_at DESC
`;

/**
 * Las bajas del día que se está mostrando.
 *
 * Recibe la fecha, NO la recalcula: tiene que ser la MISMA con la que el rutero
 * eligió sus paradas. Dos relojes distintos cerca de medianoche dirían cosas
 * contradictorias en la misma pantalla.
 *
 * Devuelve el `error` en vez de tragárselo: un fallo mudo aquí se lee como "no
 * te quitaron nada", que es la conclusión contraria a la verdadera.
 */
export function useRetirosDeHoy(fecha: string): {
  retiradas: RetiradaLocal[];
  error: Error | undefined;
} {
  const { data, error } = useQuery<RetiradaLocal>(SQL, [fecha]);
  return { retiradas: data ?? [], error };
}

/**
 * De las filas replicadas a lo que se pinta.
 *
 * El gemelo puro de la consulta, como `rechazosDentroDeVentana` lo es de la
 * suya: existe aparte para poder probar la regla sin el motor nativo.
 */
export function avisosDeRetiro(
  retiradas: readonly RetiradaLocal[],
  descartados: ReadonlySet<string>,
  tiendasEnRuta: ReadonlySet<string>,
): AvisoDeRetiro[] {
  const recientesPrimero = [...retiradas].sort((a, b) =>
    a.retirada_at < b.retirada_at ? 1 : a.retirada_at > b.retirada_at ? -1 : 0,
  );

  const vistas = new Set<string>();
  const avisos: AvisoDeRetiro[] = [];

  for (const r of recientesPrimero) {
    if (descartados.has(r.id)) continue;
    // Si la tienda SIGUE en la ruta de hoy, no se anuncia su pérdida: la
    // quitaron y se la devolvieron, o nunca llegó a irse de esta pantalla.
    // Anunciarla sería mentir en la dirección contraria.
    if (tiendasEnRuta.has(r.tienda_id)) continue;
    // Una tienda quitada dos veces es un hecho, no dos.
    if (vistas.has(r.tienda_id)) continue;
    vistas.add(r.tienda_id);

    avisos.push({
      id: r.id,
      tienda: r.tienda_nombre ?? TIENDA_SIN_NOMBRE,
      retirada_at: r.retirada_at,
      motivo: r.motivo,
    });
  }

  return avisos;
}

/**
 * Si ESTA tienda salió de la ruta, para la pantalla de check-in.
 *
 * Se consulta por tienda y no por parada porque la tabla de auditoría no guarda
 * el id de la parada: cuando la parada desaparece de la réplica, no queda de
 * dónde sacarlo. Quien llama tiene que recordar la tienda que ya estaba
 * mostrando — así el aviso solo se da cuando hay prueba, nunca por sospecha.
 *
 * Sin cota de fecha a propósito: si la parada de hoy sigue viva, quien llama no
 * pregunta; y si ya no está, que la tienda tenga un retiro registrado es
 * exactamente la respuesta que se busca.
 */
export function useRetiroDeTienda(
  tiendaId: string | null,
): RetiradaLocal | null {
  const { data } = useQuery<RetiradaLocal>(
    tiendaId === null ? SQL_SIN_TIENDA : SQL_POR_TIENDA,
    tiendaId === null ? [] : [tiendaId],
  );
  return tiendaId === null ? null : (data?.[0] ?? null);
}

const SQL_POR_TIENDA = `
  SELECT rr.id, rr.tienda_id, rr.fecha, rr.retirada_at, rr.motivo,
         t.nombre AS tienda_nombre
  FROM rutero_parada_retirada rr
  LEFT JOIN tienda t ON t.id = rr.tienda_id
  WHERE rr.tienda_id = ?
  ORDER BY rr.retirada_at DESC
  LIMIT 1
`;

/** Una consulta que no devuelve nada, para cuando aún no hay tienda que mirar. */
const SQL_SIN_TIENDA = "SELECT NULL AS id WHERE 0";

// ---------------------------------------------------------------------------
// El descarte, en disco y acotado al día
// ---------------------------------------------------------------------------

const RUTA = `${FileSystem.documentDirectory}descartes-retiro.json`;

export type DescartesGuardados = { fecha: string; ids: string[] };

/**
 * Lo descartado que sigue vigente hoy.
 *
 * Acotarlo por día es lo que hace que el fichero se pode solo: el descarte de
 * ayer no puede ocultar el aviso de hoy, y no hace falta limpiarlo nunca.
 */
export function descartadosVigentes(
  guardado: DescartesGuardados | null,
  hoy: string,
): Set<string> {
  if (guardado === null || guardado.fecha !== hoy) return new Set();
  return new Set(guardado.ids);
}

function comoGuardado(datos: unknown): DescartesGuardados | null {
  if (typeof datos !== "object" || datos === null) return null;
  const { fecha, ids } = datos as { fecha?: unknown; ids?: unknown };
  if (typeof fecha !== "string" || !Array.isArray(ids)) return null;
  return { fecha, ids: ids.filter((i): i is string => typeof i === "string") };
}

async function leerGuardado(): Promise<DescartesGuardados | null> {
  // El `try` cubre TAMBIÉN el `getInfoAsync`. Fuera de él, un fallo de disco
  // —distinto del JSON ilegible— se propagaría hasta el `.then()` de la pantalla
  // y quedaría sin manejar, que es justo lo contrario de lo que promete este
  // módulo: se falla hacia MOSTRAR, nunca hacia ocultar. Un fichero que no se
  // puede leer no puede convertirse en "ya se lo dijimos".
  try {
    const info = await FileSystem.getInfoAsync(RUTA);
    if (!info.exists) return null;
    return comoGuardado(JSON.parse(await FileSystem.readAsStringAsync(RUTA)));
  } catch {
    console.warn("[retiros] no se pudieron leer los descartes");
    return null;
  }
}

export async function leerDescartes(hoy: string): Promise<Set<string>> {
  return descartadosVigentes(await leerGuardado(), hoy);
}

/**
 * Descarta un aviso y devuelve el conjunto resultante, para que la pantalla no
 * tenga que recomponerlo.
 *
 * Si la escritura falla, el aviso queda oculto en esta sesión y reaparece al
 * reabrir la app. Es el lado seguro del fallo.
 */
export async function descartarRetiro(
  id: string,
  hoy: string,
): Promise<Set<string>> {
  const vigentes = descartadosVigentes(await leerGuardado(), hoy);
  vigentes.add(id);
  try {
    await FileSystem.writeAsStringAsync(
      RUTA,
      JSON.stringify({ fecha: hoy, ids: [...vigentes] }),
    );
  } catch {
    console.warn("[retiros] no se pudo guardar el descarte");
  }
  return vigentes;
}
