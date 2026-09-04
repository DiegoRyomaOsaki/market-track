// Reglas del check-out, fuera de la UI. El check-out valida DATOS obligatorios
// (que cada marca quedó auditada u omitida por contingencia), NO que las fotos
// ya hayan subido: la subida a R2 ocurre después, sin bloquear la salida.

/**
 * La visita está lista para check-out cuando toda marca a auditar quedó
 * `completado` u `omitido`. Sin marcas todavía (rutero mal cargado) no está
 * lista: no hay nada que cerrar.
 */
export function visitaListaParaCheckOut(
  estadosLevantamiento: readonly (string | null)[],
): boolean {
  if (estadosLevantamiento.length === 0) return false;
  return estadosLevantamiento.every(
    (e) => e === "completado" || e === "omitido",
  );
}
