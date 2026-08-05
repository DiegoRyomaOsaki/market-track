import type { Database } from "@market-track/db";

import { diaEnLima } from "@/lib/fecha-lima";

import type { ColorPin } from "@/lib/mapa/pines";

// La lógica PURA del dashboard del portal (MAR-55): el período por defecto y el
// anterior, la tendencia vs. el período previo, el color del pin y el armado de
// las tarjetas de KPI desde la fila que devuelve `dashboard_kpis`. Vive fuera de
// la UI para poder probarla; los números los calcula la base (la función SQL).

// El generador tipa toda columna de una función `returns table` como no-nula,
// pero `cumplimiento_pct`/`sos_pct` (y sus `_prev`) son nulos cuando no hay datos
// en la ventana (`nullif` en la función). Se corrige la nulabilidad aquí; la fila
// cruda del rpc (no-nula) sigue siendo asignable a este tipo (más amplio).
type FilaKpisCruda =
  Database["public"]["Functions"]["dashboard_kpis"]["Returns"][number];

export type FilaKpis = Omit<
  FilaKpisCruda,
  "cumplimiento_pct" | "cumplimiento_pct_prev" | "sos_pct" | "sos_pct_prev"
> & {
  cumplimiento_pct: number | null;
  cumplimiento_pct_prev: number | null;
  sos_pct: number | null;
  sos_pct_prev: number | null;
};

export type Periodo = { desde: string; hasta: string };

function aISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

function desdeISO(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

const DIA_MS = 86_400_000;

/** El período por defecto del dashboard: los últimos 30 días hasta `ref` (hoy en Lima). */
export function periodoPorDefecto(ref: Date): Periodo {
  // El "hoy" del dashboard es el día de Lima, no el de UTC. Ver `lib/fecha-lima`.
  const hasta = diaEnLima(ref);
  const desde = aISO(new Date(desdeISO(hasta).getTime() - 29 * DIA_MS));
  return { desde, hasta };
}

/**
 * El período que pidieron los filtros, completando el extremo que falte.
 *
 * Con solo "Desde" puesto, caer al default de 30 días ignora en silencio lo que
 * el usuario escribió: se respeta su extremo y se completa el otro.
 */
export function periodoDeFiltros(
  filtros: { desde: string | null; hasta: string | null },
  ref: Date,
): Periodo {
  const hoy = diaEnLima(ref);
  if (filtros.desde && filtros.hasta) {
    return { desde: filtros.desde, hasta: filtros.hasta };
  }
  if (filtros.desde) return { desde: filtros.desde, hasta: hoy };
  if (filtros.hasta) {
    return {
      desde: aISO(new Date(desdeISO(filtros.hasta).getTime() - 29 * DIA_MS)),
      hasta: filtros.hasta,
    };
  }
  return periodoPorDefecto(ref);
}

/** El período ANTERIOR: misma duración, justo antes de `desde`. Para la tendencia. */
export function periodoAnterior({ desde, hasta }: Periodo): Periodo {
  const d1 = desdeISO(desde);
  const d2 = desdeISO(hasta);
  const duracion = Math.round((d2.getTime() - d1.getTime()) / DIA_MS);
  const prevHasta = new Date(d1.getTime() - DIA_MS);
  const prevDesde = new Date(prevHasta.getTime() - duracion * DIA_MS);
  return { desde: aISO(prevDesde), hasta: aISO(prevHasta) };
}

export type Tendencia =
  | { disponible: false }
  | { disponible: true; delta: number; direccion: "sube" | "baja" | "igual" };

/** La variación de un KPI respecto al período anterior. `null` en el previo (sin
 * datos comparables) → no disponible. */
export function calcularTendencia(
  actual: number | null,
  previo: number | null,
): Tendencia {
  if (actual == null || previo == null) return { disponible: false };
  const delta = Math.round((actual - previo) * 10) / 10;
  const direccion = delta > 0 ? "sube" : delta < 0 ? "baja" : "igual";
  return { disponible: true, delta, direccion };
}

/** El color del pin de una tienda. Rojo = alerta o no visitada; ámbar = visita en
 * curso; verde = visita completada (design §8.1). El rojo por alerta manda aunque
 * la visita esté completada. */
export function colorDePin(
  ultimaVisitaEstado: string | null,
  tieneAlerta: boolean,
  visitada: boolean,
): ColorPin {
  if (tieneAlerta || !visitada) return "rojo";
  if (ultimaVisitaEstado === "en_curso") return "ambar";
  if (ultimaVisitaEstado === "completada") return "verde";
  return "rojo";
}

export type Kpi = {
  clave: string;
  etiqueta: string;
  valor: string;
  tendencia: Tendencia;
  // Para colorear la flecha: en cumplimiento/SOS/exhibiciones "subir" es bueno;
  // en quiebres/diferencias/desviaciones, subir es malo.
  subirEsBueno: boolean;
};

function pct(v: number | null): string {
  return v == null ? "—" : `${v}%`;
}

function entero(v: number | null): string {
  return v == null ? "—" : String(v);
}

/** Arma las 6 tarjetas de KPI desde la fila de `dashboard_kpis`. */
export function armarKpis(fila: FilaKpis): Kpi[] {
  return [
    {
      clave: "cumplimiento",
      etiqueta: "Cumplimiento de rutero",
      valor: pct(fila.cumplimiento_pct),
      tendencia: calcularTendencia(
        fila.cumplimiento_pct,
        fila.cumplimiento_pct_prev,
      ),
      subirEsBueno: true,
    },
    {
      clave: "quiebres",
      etiqueta: "Quiebres",
      valor: entero(fila.quiebres),
      tendencia: calcularTendencia(fila.quiebres, fila.quiebres_prev),
      subirEsBueno: false,
    },
    {
      clave: "diferencias",
      etiqueta: "Diferencias de stock",
      valor: entero(fila.diferencias),
      tendencia: calcularTendencia(fila.diferencias, fila.diferencias_prev),
      subirEsBueno: false,
    },
    {
      clave: "sos",
      etiqueta: "Share of Shelf",
      valor: pct(fila.sos_pct),
      tendencia: calcularTendencia(fila.sos_pct, fila.sos_pct_prev),
      subirEsBueno: true,
    },
    {
      clave: "exhibiciones",
      etiqueta: "Exhibiciones cumplidas",
      valor:
        fila.exhib_negociadas === 0
          ? "—"
          : `${fila.exhib_cumplidas} / ${fila.exhib_negociadas}`,
      tendencia: calcularTendencia(
        fila.exhib_cumplidas,
        fila.exhib_cumplidas_prev,
      ),
      subirEsBueno: true,
    },
    {
      clave: "precio",
      etiqueta: "Desviaciones de precio",
      valor: entero(fila.desviaciones_precio),
      tendencia: calcularTendencia(
        fila.desviaciones_precio,
        fila.desviaciones_precio_prev,
      ),
      subirEsBueno: false,
    },
  ];
}
