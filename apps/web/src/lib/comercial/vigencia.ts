// La ventana de vigencia de un periodo de precio, para pintarla.
//
// Esto NO es la regla de negocio: la regla —cuál de varios periodos gana en una
// fecha— vive en `app.precio_regular_vigente` y tiene un solo dueño en SQL. Lo
// de aquí es una contención de rango para decidir qué insignia lleva una fila
// que la lista YA tiene delante.
//
// `vigente_hasta` es INCLUSIVO: el último día en que el precio rige. Nulo = sigue
// vigente. Los cuatro bordes se prueban porque un error de un día aquí es
// invisible hasta que alguien compara un reporte.

/** ¿El periodo cubre ese día? Las dos fechas son `YYYY-MM-DD`. */
export function esVigenteEn(
  vigenteDesde: string,
  vigenteHasta: string | null,
  dia: string,
): boolean {
  if (vigenteDesde > dia) return false;
  return vigenteHasta === null || vigenteHasta >= dia;
}

/**
 * El texto de la ventana, para que la insignia no sea solo un color (WCAG 1.4.1).
 *
 * Un periodo futuro no dice "Vigente": diría que rige algo que aún no ha
 * empezado, que es justo lo que este módulo existe para no confundir.
 */
export function etiquetaVigencia(
  vigenteDesde: string,
  vigenteHasta: string | null,
  dia: string,
): string {
  if (esVigenteEn(vigenteDesde, vigenteHasta, dia)) return "Vigente";
  if (vigenteDesde > dia) return "Programado";
  return "Cerrado";
}
