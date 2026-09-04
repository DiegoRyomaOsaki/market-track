/**
 * Un importe en soles, con su símbolo y sus dos decimales.
 *
 * Existe porque la misma expresión aparecía ya en la revisión de reportes y hacía
 * falta en precios y en promociones: tres sitios donde el símbolo o los decimales
 * podían separarse sin que nadie lo notara.
 *
 * `toFixed` y no `Intl.NumberFormat`: los importes vienen de columnas
 * `numeric(10,2)` y lo que se quiere es exactamente lo que hay en la base, sin
 * separador de miles dependiente del locale del servidor.
 */
export function soles(monto: number): string {
  return `S/ ${monto.toFixed(2)}`;
}
