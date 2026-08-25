import { useQuery } from "@powersync/react-native";
import { useMemo } from "react";

// El rutero del día, leído de la réplica local (nunca de la red — ADR-0001).
// Las sync rules ya bajan solo el rutero de ESTE mercaderista, así que no hay que
// filtrar por usuario: basta la fecha.

export type EstadoVisual = "pendiente" | "en_curso" | "completada";

export type ParadaDeHoy = {
  parada_id: string;
  tenant_id: string;
  orden: number;
  tienda_id: string;
  tienda_nombre: string;
  tienda_direccion: string | null;
  lat: number | null;
  lon: number | null;
  radio_geocerca_m: number | null;
  visita_id: string | null;
  visita_estado: string | null;
  check_in_at: string | null;
  /** Nula mientras el supervisor no haya revisado el reporte de esa visita. */
  revision_decision: string | null;
  /** `HH:MM:SS` de Lima, o null si el supervisor no fijó ninguna. */
  hora_planificada: string | null;
};

/**
 * El estado que se muestra por tienda. Se DERIVA de la visita local, no de
 * `rutero_parada.estado`: el móvil no puede escribir esa columna (la actualiza el
 * staff/servidor), y derivarla deja que la parada pase a "en curso" apenas se hace
 * check-in, sin esperar a que el servidor devuelva el cambio.
 */
export function estadoVisual(visitaEstado: string | null): EstadoVisual {
  if (visitaEstado === "completada") return "completada";
  if (visitaEstado === "en_curso" || visitaEstado === "bloqueada") {
    return "en_curso";
  }
  return "pendiente";
}

/**
 * La hora esperada, en `HH:MM`, o null si no se fijó.
 *
 * Es INFORMATIVA: llegar tarde no impide fichar. La geocerca bloquea; la hora
 * no — dejar a un mercaderista fuera de su propia visita por llegar tarde sería
 * castigar dos veces y, sobre todo, perder el dato de que estuvo allí.
 */
export function horaEsperada(hora: string | null): string | null {
  return hora ? hora.slice(0, 5) : null;
}

function fechaHoyLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

const SQL = `
  SELECT rp.id AS parada_id, rp.tenant_id AS tenant_id, rp.orden, rp.tienda_id,
         rp.hora_planificada AS hora_planificada,
         t.nombre AS tienda_nombre, t.direccion AS tienda_direccion,
         t.lat AS lat, t.lon AS lon, t.radio_geocerca_m AS radio_geocerca_m,
         v.id AS visita_id, v.estado AS visita_estado, v.check_in_at AS check_in_at,
         rv.decision AS revision_decision
  FROM rutero_parada rp
  JOIN rutero r ON r.id = rp.rutero_id
  JOIN tienda t ON t.id = rp.tienda_id
  LEFT JOIN visita v ON v.rutero_parada_id = rp.id
  -- Si al supervisor le da tiempo de revisarla el mismo día, se ve aquí. Los
  -- rechazos de días anteriores van al banner de la portada, que es donde el
  -- mercaderista los verá de verdad.
  LEFT JOIN revision_visita rv ON rv.visita_id = v.id
  WHERE r.fecha = ? AND r.estado <> 'borrador'
  ORDER BY rp.orden
`;

export function useRuteroDeHoy() {
  const hoy = useMemo(() => fechaHoyLocal(), []);
  const { data, isLoading, error } = useQuery<ParadaDeHoy>(SQL, [hoy]);
  return { paradas: data ?? [], cargando: isLoading, error, fecha: hoy };
}

/** Una sola parada por id, para la pantalla de check-in. */
const SQL_PARADA = `
  SELECT rp.id AS parada_id, rp.tenant_id AS tenant_id, rp.orden, rp.tienda_id,
         rp.hora_planificada AS hora_planificada,
         t.nombre AS tienda_nombre, t.direccion AS tienda_direccion,
         t.lat AS lat, t.lon AS lon, t.radio_geocerca_m AS radio_geocerca_m,
         v.id AS visita_id, v.estado AS visita_estado, v.check_in_at AS check_in_at,
         rv.decision AS revision_decision
  FROM rutero_parada rp
  JOIN tienda t ON t.id = rp.tienda_id
  LEFT JOIN visita v ON v.rutero_parada_id = rp.id
  LEFT JOIN revision_visita rv ON rv.visita_id = v.id
  WHERE rp.id = ?
`;

export function useParada(paradaId: string) {
  const { data, isLoading } = useQuery<ParadaDeHoy>(SQL_PARADA, [paradaId]);
  return { parada: data?.[0] ?? null, cargando: isLoading };
}

// ---------------------------------------------------------------------------
// El historial por tienda: "la última vez esta tienda quedó en 78"
//
// Es lo que el cliente pidió literalmente: "Plaza Vea Higuereta, fecha de última
// visita, puntaje de la última visita… ah, la última vez no estuvo tan bien,
// entonces hoy voy y la dejo perfecta".
//
// El móvil NO calcula Perfect Store: lo calcula la base, una sola vez, por
// levantamiento (`app.calcular_puntaje_perfect_store`), y ese sigue siendo su
// único dueño. Lo de aquí es AGREGAR varias filas ya derivadas —una visita tiene
// un levantamiento por marca— con el mismo `avg(total_pct)` con el que el panel
// agrega en `public.perfect_store_agregado`. Y va respaldado por
// `promedioPerfectStore`, su gemelo puro: la consulta la resuelve SQLite, la
// función la resuelve en TypeScript y un test afirma que dicen lo mismo.
// ---------------------------------------------------------------------------

export type UltimaVisita = {
  tienda_id: string;
  /** La parada de aquella visita — sirve para descartar la de hoy. */
  rutero_parada_id: string | null;
  check_out_at: string;
  /** Null cuando ningún levantamiento de esa visita llegó a puntuar. */
  perfect_store_pct: number | null;
};

const SQL_ULTIMA_VISITA = `
  WITH ordenadas AS (
    SELECT v.id, v.tienda_id, v.rutero_parada_id, v.check_out_at,
           -- Desempate por id: dos visitas con el mismo instante devolverían dos
           -- filas por tienda con un MAX() + join por igualdad.
           ROW_NUMBER() OVER (PARTITION BY v.tienda_id
                              ORDER BY v.check_out_at DESC, v.id DESC) AS n
    FROM visita v
    WHERE v.estado = 'completada' AND v.check_out_at IS NOT NULL
  )
  SELECT o.tienda_id, o.rutero_parada_id, o.check_out_at,
         -- AVG ignora los nulos, igual que en Postgres: un levantamiento sin
         -- puntuar no arrastra la visita a cero. Si TODOS son nulos, sale nulo.
         ROUND(AVG(p.total_pct), 2) AS perfect_store_pct
  FROM ordenadas o
  LEFT JOIN levantamiento l ON l.visita_id = o.id
  -- El id de PowerSync de puntaje_perfect_store ES el levantamiento (1:1).
  LEFT JOIN puntaje_perfect_store p ON p.id = l.id
  WHERE o.n = 1
  GROUP BY o.tienda_id, o.rutero_parada_id, o.check_out_at
`;

export function useUltimaVisitaPorTienda(): UltimaVisita[] {
  const { data } = useQuery<UltimaVisita>(SQL_ULTIMA_VISITA);
  return data ?? [];
}

/**
 * La última visita a una tienda que NO sea la parada de hoy.
 *
 * El descarte no es un detalle: si el mercaderista ya hizo el check-out de hoy,
 * "la última vez" tiene que seguir siendo la anterior. Enseñarle el puntaje que
 * acaba de sacar como referencia de lo que va a mejorar no dice nada.
 */
export function ultimaVisitaAjena(
  visitas: readonly UltimaVisita[],
  tiendaId: string,
  paradaDeHoyId: string,
): UltimaVisita | null {
  return (
    visitas.find(
      (v) => v.tienda_id === tiendaId && v.rutero_parada_id !== paradaDeHoyId,
    ) ?? null
  );
}

/**
 * El gemelo puro del `ROUND(AVG(total_pct), 2)` de la consulta. Existe aparte
 * para poder probar la regla sin el motor nativo — el mismo patrón que
 * `rechazosDentroDeVentana` con su consulta.
 */
export function promedioPerfectStore(
  totales: readonly (number | null)[],
): number | null {
  const validos = totales.filter((t): t is number => t !== null);
  if (validos.length === 0) return null;
  const media = validos.reduce((a, b) => a + b, 0) / validos.length;
  return Math.round(media * 100) / 100;
}
