// Las utilidades de fecha del panel.
//
// `diaEnLima` NO vive aquí: es la regla que el móvil también necesita para
// resolver su periodo, así que su dueño es `packages/shared`. Se reexporta para
// que los consumidores del panel sigan importándola de este módulo.

export { diaEnLima } from "@market-track/shared";

const DIA_MS = 86_400_000;

/** Un `YYYY-MM-DD` como fecha, anclada a mediodía UTC para que sumar días no
 *  cruce ningún límite de zona horaria por redondeo. */
function desdeISO(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

/** Suma (o resta) días a un `YYYY-MM-DD` y devuelve otro `YYYY-MM-DD`. */
export function sumarDias(iso: string, dias: number): string {
  return new Date(desdeISO(iso).getTime() + dias * DIA_MS)
    .toISOString()
    .slice(0, 10);
}

/** Cuántos días hay entre dos `YYYY-MM-DD` (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((desdeISO(b).getTime() - desdeISO(a).getTime()) / DIA_MS);
}

/** Los días de un rango, inclusivo, como `YYYY-MM-DD`. */
export function diasDelRango(desde: string, hasta: string): string[] {
  const total = diasEntre(desde, hasta);
  if (total < 0) return [];
  return Array.from({ length: total + 1 }, (_, i) => sumarDias(desde, i));
}
