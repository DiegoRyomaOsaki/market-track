import {
  detalleIncidenciaSchema,
  type EstadoIncidencia,
  type OrigenIncidencia,
} from "@market-track/shared";
import { useQuery } from "@powersync/react-native";
import { useMemo } from "react";

import { encolarFoto } from "./cola-fotos-instancia";
import type { FotoCapturada } from "./foto-captura";
import { db } from "./powersync/db";

// La lista global de incidencias de una visita, y su resolución.
//
// El acuerdo de la 4ª revisión: la incidencia no se cierra diciendo "ya está",
// se cierra con la acción tomada y una foto. Y la lista es de la VISITA, no del
// módulo — "si estabas en góndola y pasó una hora, en tu cabeza no vas a decir
// «tenía que entrar a góndola porque ahí tenía la incidencia»".
//
// Nada de esto RECALCULA nada: la incidencia la crea el motor en la base a
// partir del dato levantado, y aquí solo se lee, se describe y se atiende.

/** Una incidencia tal como baja a la réplica, con lo que hace falta pintarla. */
export type IncidenciaLocal = {
  id: string;
  visita_id: string;
  levantamiento_id: string | null;
  marca_id: string | null;
  marca_nombre: string | null;
  sku_nombre: string | null;
  origen: OrigenIncidencia;
  estado: EstadoIncidencia;
  detalle: string | null;
  accion_tomada: string | null;
  motivo: string | null;
  creado_at: string;
};

/**
 * Las incidencias de TODA la visita, en una sola consulta.
 *
 * Por visita y no por marca: la lista las agrupa después en memoria, y una
 * consulta por marca sería un N+1 sobre la réplica en el camino de pintado.
 *
 * `anulada` se excluye aquí y no en quien pinta: es una incidencia que dejó de
 * existir porque el mercaderista corrigió el dato, y no tiene nada que decirle.
 */
export function useIncidenciasDeVisita(visitaId: string) {
  const { data, isLoading, error } = useQuery<IncidenciaLocal>(
    `SELECT i.id, i.visita_id, i.levantamiento_id, i.marca_id,
            m.nombre AS marca_nombre, s.nombre AS sku_nombre,
            i.origen, i.estado, i.detalle, i.accion_tomada, i.motivo, i.creado_at
       FROM incidencia i
       LEFT JOIN marca m ON m.id = i.marca_id
       LEFT JOIN sku s ON s.id = i.sku_id
      WHERE i.visita_id = ? AND i.estado <> 'anulada'
      ORDER BY i.creado_at`,
    [visitaId],
  );
  return {
    incidencias: data ?? [],
    cargando: isLoading,
    error: error ? String(error) : null,
  };
}

/** Cuántas quedan por atender. `no_resuelta` ya fue atendida: no cuenta. */
export function contarPendientes(
  incidencias: readonly IncidenciaLocal[],
): number {
  return incidencias.filter((i) => i.estado === "pendiente").length;
}

export type GrupoDeMarca = {
  marcaId: string | null;
  marcaNombre: string;
  incidencias: IncidenciaLocal[];
};

/**
 * Agrupa por marca — "te sale marca A: incidencias; marca B: incidencia".
 *
 * Las pendientes primero dentro de cada grupo: es lo que el mercaderista tiene
 * que atender antes de salir. Los grupos se ordenan por nombre, y la marca sin
 * nombre —una incidencia que no cuelga de ninguna— cae al final en su propio
 * grupo en vez de mezclarse con otra.
 */
export function agruparPorMarca(
  incidencias: readonly IncidenciaLocal[],
): GrupoDeMarca[] {
  const grupos = new Map<string | null, GrupoDeMarca>();
  for (const incidencia of incidencias) {
    const entrada = grupos.get(incidencia.marca_id) ?? {
      marcaId: incidencia.marca_id,
      marcaNombre: incidencia.marca_nombre ?? "Sin marca",
      incidencias: [],
    };
    entrada.incidencias.push(incidencia);
    grupos.set(incidencia.marca_id, entrada);
  }

  for (const grupo of grupos.values()) {
    grupo.incidencias.sort((a, b) => {
      const pendiente = (i: IncidenciaLocal) =>
        i.estado === "pendiente" ? 0 : 1;
      return pendiente(a) - pendiente(b);
    });
  }

  return [...grupos.values()].sort((a, b) => {
    if (a.marcaId === null) return 1;
    if (b.marcaId === null) return -1;
    return a.marcaNombre.localeCompare(b.marcaNombre);
  });
}

/**
 * Qué dice la incidencia, con los números que el motor guardó.
 *
 * Mapa exhaustivo y no un `switch` con `default`: un origen nuevo tiene que
 * romper la compilación aquí, no caer en un texto genérico que nadie note. Los
 * números salen de `detalle`; no se re-derivan (para eso está el motor).
 */
const DESCRIPCION: Record<
  OrigenIncidencia,
  (d: ReturnType<typeof detalleIncidenciaSchema.parse>) => string
> = {
  quiebre: (d) =>
    d.stock_sistema != null
      ? `Quiebre: ${d.stock_sistema} en sistema y 0 en piso`
      : "Quiebre: sin stock en piso",
  diferencia_stock: (d) =>
    d.stock_sistema != null && d.stock_piso != null
      ? `Diferencia: ${d.stock_sistema} en sistema y ${d.stock_piso} en piso`
      : "Diferencia entre el stock del sistema y el de piso",
  desviacion_precio: (d) =>
    d.precio_registrado != null && d.precio_regular != null
      ? `Precio S/ ${d.precio_registrado} — el regular es S/ ${d.precio_regular}`
      : "El precio en tienda se desvía del regular",
  promo_no_comunicada: (d) =>
    d.precio_registrado != null
      ? `Promoción no comunicada: en tienda está a S/ ${d.precio_registrado}`
      : "Hay una promoción en tienda que no estaba comunicada",
  exhibicion_no_instalada: () => "La exhibición negociada no está instalada",
  incumplimiento_planograma: () => "La góndola no cumple el planograma",
};

export function describirIncidencia(
  origen: OrigenIncidencia,
  detalle: string | null,
): string {
  return DESCRIPCION[origen](
    detalleIncidenciaSchema.parse(leerDetalle(detalle)),
  );
}

/** El jsonb llega a SQLite como texto; un texto roto no puede tumbar la lista. */
function leerDetalle(detalle: string | null): unknown {
  if (!detalle) return {};
  try {
    return JSON.parse(detalle);
  } catch {
    return {};
  }
}

/** El texto que describe cada estado, para que el color no sea la única señal. */
export const ETIQUETA_ESTADO: Record<EstadoIncidencia, string> = {
  pendiente: "Pendiente",
  resuelta: "Resuelta",
  no_resuelta: "Atendida con observación",
  // No se pinta —`useIncidenciasDeVisita` la excluye— pero el mapa es exhaustivo
  // para que añadir un estado rompa la compilación en vez de caer en blanco.
  anulada: "Corregida antes de atenderla",
};

export type DatosResolucion = {
  incidenciaId: string;
  visitaId: string;
  tenantId: string;
  levantamientoId: string | null;
  accionTomada: string;
  foto: FotoCapturada;
};

/**
 * Resuelve una incidencia: la acción tomada y su foto de evidencia.
 *
 * La foto y el enlace se escriben en la MISMA transacción local. PowerSync
 * agrupa las operaciones por transacción de SQLite y el conector las sube en ese
 * orden, así que el PUT de la foto llega antes que el PATCH que la referencia.
 * Al revés, el servidor devolvería un `23503` que el conector clasifica como
 * permanente y descarta — perdiendo la resolución en silencio.
 */
export async function resolverIncidencia(d: DatosResolucion): Promise<void> {
  await encolarFoto(
    {
      foto: d.foto,
      tenantId: d.tenantId,
      visitaId: d.visitaId,
      levantamientoId: d.levantamientoId,
      tipo: "resolucion_incidencia",
    },
    async (tx, fotoId) => {
      await tx.execute(
        `UPDATE incidencia
            SET estado = 'resuelta', accion_tomada = ?,
                foto_resolucion_id = ?, atendida_at = ?
          WHERE id = ?`,
        [d.accionTomada, fotoId, new Date().toISOString(), d.incidenciaId],
      );
    },
  );
}

/**
 * El mercaderista no pudo resolverla, y dice por qué.
 *
 * No desaparece de la lista: queda atendida con observación. El supervisor
 * necesita ver que se miró y por qué se quedó así, que es la mitad del valor de
 * la lista.
 */
export async function noPuedoResolver(d: {
  incidenciaId: string;
  motivo: string;
}): Promise<void> {
  await db.execute(
    `UPDATE incidencia
        SET estado = 'no_resuelta', motivo = ?, atendida_at = ?
      WHERE id = ?`,
    [d.motivo, new Date().toISOString(), d.incidenciaId],
  );
}

/** El resumen que la cabecera pinta desde cualquier módulo. */
export function useResumenIncidencias(visitaId: string) {
  const { incidencias, cargando, error } = useIncidenciasDeVisita(visitaId);
  const pendientes = useMemo(
    () => contarPendientes(incidencias),
    [incidencias],
  );
  return { incidencias, pendientes, cargando, error };
}
