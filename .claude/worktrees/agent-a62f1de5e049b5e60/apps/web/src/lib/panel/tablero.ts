import type { Database } from "@market-track/db";

import { diaEnLima } from "@/lib/fecha-lima";
import type { ColorPin } from "@/lib/mapa/pines";

// La lógica PURA del tablero del día: cómo se lee una fila en pantalla y cómo se
// aplica encima un evento que llega por Realtime. Los números y los campos
// derivados los calcula la base (`tablero_dia`); aquí solo se da forma.

// El generador tipa toda columna de una función `returns table` como no-nula,
// pero varias de estas sí lo son: el DNI es opcional en `profile`, el motivo solo
// existe si hubo contingencia, la salida falta mientras la visita está en curso y
// la tienda puede no tener ubicación cargada. Se corrige aquí la nulabilidad; la
// fila cruda del rpc (no-nula) sigue siendo asignable a este tipo, más amplio.
type FilaTableroCruda =
  Database["public"]["Functions"]["tablero_dia"]["Returns"][number];

type CamposOpcionales =
  | "mercaderista_dni"
  | "check_out_at"
  | "duracion_min"
  | "tiempo_traslado_min"
  | "bateria_inicio_pct"
  | "motivo"
  | "tienda_lat"
  | "tienda_lon";

export type FilaTablero = Omit<FilaTableroCruda, CamposOpcionales> & {
  mercaderista_dni: string | null;
  check_out_at: string | null;
  duracion_min: number | null;
  tiempo_traslado_min: number | null;
  bateria_inicio_pct: number | null;
  motivo: string | null;
  tienda_lat: number | null;
  tienda_lon: number | null;
};

type ContingenciaCruda =
  Database["public"]["Functions"]["tablero_contingencias"]["Returns"][number];

export type Contingencia = Omit<ContingenciaCruda, "paso" | "motivo"> & {
  paso: string | null;
  motivo: string | null;
};

/** El día de calendario en Lima, que es el "hoy" del negocio — nunca el de UTC. */
export const hoyEnLima = diaEnLima;

type EstadoVisita = Database["public"]["Enums"]["estado_visita"];

/**
 * El color del pin de una visita en el tablero. Es el estado operativo del día:
 * bloqueada manda sobre todo, porque es lo que exige una decisión del supervisor.
 */
const COLOR_POR_ESTADO: Record<EstadoVisita, ColorPin> = {
  completada: "verde",
  en_curso: "ambar",
  bloqueada: "rojo",
};

const TEXTO_POR_ESTADO: Record<EstadoVisita, string> = {
  completada: "visita completada",
  en_curso: "visita en curso",
  bloqueada: "visita bloqueada",
};

export function colorDeVisita(estado: EstadoVisita): ColorPin {
  return COLOR_POR_ESTADO[estado];
}

export function textoDeVisita(estado: EstadoVisita): string {
  return TEXTO_POR_ESTADO[estado];
}

/** "1 h 25 min", "45 min". Null cuando la base no pudo calcularla. */
export function formatoDuracion(minutos: number | null): string {
  if (minutos === null || minutos < 0) return "—";
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas === 0) return `${resto} min`;
  return `${horas} h ${resto} min`;
}

/** Las contingencias que el supervisor todavía no ha atendido. */
export function sinAtender(contingencias: readonly Contingencia[]): number {
  return contingencias.filter((c) => c.estado !== "resuelta").length;
}

/**
 * Aplica una fila que llegó por Realtime sobre las que ya están en pantalla.
 *
 * El broadcast trae la fila CRUDA de `visita`, no la del tablero (que lleva el
 * nombre del mercaderista, las fotos y el motivo). Por eso no se puede construir
 * una fila nueva desde el evento: solo se refrescan los campos que el evento sí
 * trae, y una visita que aún no está en la tabla se ignora — la trae la próxima
 * carga del servidor, con todos sus datos.
 */
export function aplicarCambioDeVisita(
  filas: readonly FilaTablero[],
  cambio: {
    id: string;
    estado: EstadoVisita;
    check_out_at: string | null;
  },
): FilaTablero[] {
  let tocada = false;
  const siguientes = filas.map((f) => {
    if (f.visita_id !== cambio.id) return f;
    tocada = true;
    return { ...f, estado: cambio.estado, check_out_at: cambio.check_out_at };
  });
  return tocada ? siguientes : [...filas];
}

/** Marca una contingencia como atendida en la lista que ya está en pantalla. */
export function marcarAtendida(
  actuales: readonly Contingencia[],
  id: string,
): Contingencia[] {
  return actuales.map((c) => (c.id === id ? { ...c, estado: "resuelta" } : c));
}
