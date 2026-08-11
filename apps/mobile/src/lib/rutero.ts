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
