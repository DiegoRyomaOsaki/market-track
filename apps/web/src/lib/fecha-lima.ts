// El calendario del negocio es el de Lima, no el de UTC.
//
// `new Date().toISOString().slice(0,10)` da la fecha UTC: entre las 19:00 y
// medianoche de Lima ya rodó al día siguiente, así que un dashboard, un rutero o
// un KPI calculados así se saltan las últimas cinco horas de la jornada — justo
// el turno de cierre de tienda. Toda ventana de fechas se resuelve aquí.
//
// Perú es UTC-5 fijo, pero se deja a `Intl` por si algún día cambia.

const FORMATO_DIA = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** El día de calendario en Lima, `YYYY-MM-DD`. */
export function diaEnLima(ref: Date): string {
  return FORMATO_DIA.format(ref);
}

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
