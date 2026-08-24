import type { PeriodoPuntaje } from "./schemas/perfect-merchandiser";

// La aritmética de periodos y los textos del ranking, puros a propósito: sin
// React y sin Supabase, que es lo que permite probarlos rama a rama.
//
// Viven aquí y no en el panel porque los DOS frentes los usan: el panel pinta
// el ranking entero y el móvil solo la fila propia, pero el periodo y la
// posición tienen que llamarse igual en los dos. Con dos copias, el panel diría
// «Julio» y el teléfono «Junio» del mismo número — y de ese número sale un bono.
//
// La
// aritmética va sobre el string ISO (año, mes, día como enteros), nunca sobre
// `Date`: un `new Date("2026-07-01")` se interpreta en UTC y en Lima todavía
// es 30 de junio.

/** El primer día del periodo que contiene un día de Lima (`YYYY-MM-DD`). */
export function inicioDePeriodo(tipo: PeriodoPuntaje, diaLima: string): string {
  const [ano, mes] = diaLima.split("-").map(Number) as [number, number];
  switch (tipo) {
    case "mensual":
      return `${ano}-${String(mes).padStart(2, "0")}-01`;
    case "trimestral": {
      const mesInicio = mes - ((mes - 1) % 3);
      return `${ano}-${String(mesInicio).padStart(2, "0")}-01`;
    }
    case "anual":
      return `${ano}-01-01`;
  }
}

/** El inicio del periodo anterior. La gemela SQL es `app.inicio_periodo_anterior`. */
export function periodoAnterior(tipo: PeriodoPuntaje, inicio: string): string {
  return sumarPeriodos(tipo, inicio, -1);
}

export function periodoSiguiente(tipo: PeriodoPuntaje, inicio: string): string {
  return sumarPeriodos(tipo, inicio, 1);
}

function sumarPeriodos(
  tipo: PeriodoPuntaje,
  inicio: string,
  cuantos: number,
): string {
  const [ano, mes] = inicio.split("-").map(Number) as [number, number];
  const meses = { mensual: 1, trimestral: 3, anual: 12 }[tipo] * cuantos;
  const total = ano * 12 + (mes - 1) + meses;
  const nuevoAno = Math.floor(total / 12);
  const nuevoMes = (total % 12) + 1;
  return `${nuevoAno}-${String(nuevoMes).padStart(2, "0")}-01`;
}

const MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

/** Cómo se nombra el periodo en la cabecera: «Julio 2026», «T3 2026», «2026». */
export function etiquetaDePeriodo(
  tipo: PeriodoPuntaje,
  inicio: string,
): string {
  const [ano, mes] = inicio.split("-").map(Number) as [number, number];
  switch (tipo) {
    case "mensual":
      return `${MESES[mes - 1]} ${ano}`;
    case "trimestral":
      return `T${Math.floor((mes - 1) / 3) + 1} ${ano}`;
    case "anual":
      return `${ano}`;
  }
}

/**
 * El delta contra el periodo anterior, ya listo para pintar. `null` en
 * cualquiera de los dos lados es «—»: sin ambos números no hay evolución, y un
 * 0 diría «igual que antes», que es otra cosa.
 */
export function formatearDelta(
  actual: number | null,
  anterior: number | null,
): string {
  if (actual === null || anterior === null) return "—";
  const delta = Math.round((actual - anterior) * 100) / 100;
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `−${Math.abs(delta)}`;
  return "=";
}

/**
 * La evolución de POSICIÓN: positivo = subió puestos (la posición bajó de
 * número). Mismo contrato de nulos que el delta de puntaje.
 */
export function formatearDeltaPosicion(
  posicion: number | null,
  posicionAnterior: number | null,
): string {
  if (posicion === null || posicionAnterior === null) return "—";
  const delta = posicionAnterior - posicion;
  if (delta > 0) return `▲ ${delta}`;
  if (delta < 0) return `▼ ${Math.abs(delta)}`;
  return "=";
}

/**
 * La dirección del delta de posición EN PALABRAS, para el lector de pantalla:
 * el triángulo solo es color y forma, y la regla del proyecto exige un
 * equivalente textual (WCAG 1.4.1).
 */
export function descripcionDeltaPosicion(
  posicion: number | null,
  posicionAnterior: number | null,
): string {
  if (posicion === null || posicionAnterior === null) return "sin comparación";
  const delta = posicionAnterior - posicion;
  if (delta > 0) return `sube ${delta} puesto${delta === 1 ? "" : "s"}`;
  if (delta < 0)
    return `baja ${Math.abs(delta)} puesto${delta === -1 ? "" : "s"}`;
  return "se mantiene";
}

/** La etiqueta de cada estado de asistencia. Record y no switch: exhaustivo. */
export const ETIQUETA_ASISTENCIA: Record<
  "pendiente" | "asistio" | "falto",
  string
> = {
  pendiente: "Pendiente",
  asistio: "Asistió",
  falto: "Faltó",
};

/** «1.º», «2.º (empate)», o «Sin datos» cuando el periodo no lo evaluó. */
export function textoDePosicion(
  posicion: number | null,
  hayEmpate: boolean,
): string {
  if (posicion === null) return "Sin datos";
  return `${posicion}.º${hayEmpate ? " (empate)" : ""}`;
}

/** Un `YYYY-MM-DD` de verdad, antes de que llegue a una consulta. */
export function esFechaISO(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [ano, mes, dia] = v.split("-").map(Number) as [number, number, number];
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31 && ano >= 2000;
}
