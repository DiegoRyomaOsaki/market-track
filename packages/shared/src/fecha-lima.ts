// El calendario del negocio es el de Lima, no el de UTC.
//
// `new Date().toISOString().slice(0,10)` da la fecha UTC: entre las 19:00 y
// medianoche de Lima ya rodó al día siguiente, así que un dashboard, un rutero o
// un KPI calculados así se saltan las últimas cinco horas de la jornada — justo
// el turno de cierre de tienda.
//
// Vive aquí y no en una app porque los DOS frentes resuelven el mismo día: el
// panel para elegir el periodo del ranking y el móvil para elegir el suyo. Si
// discreparan del día, discreparían del periodo — y entonces el panel enseñaría
// un puntaje y el teléfono otro.
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
