import {
  agruparPorMarca,
  type GrupoDeMarca,
  type IncidenciaLocal,
  sigueSinAtender,
} from "./incidencias";

// Reglas del check-out, fuera de la UI. El check-out valida DATOS obligatorios
// (que cada marca quedó auditada u omitida por contingencia, y que no queda
// ningún hallazgo sin cerrar), NO que las fotos ya hayan subido: la subida a R2
// ocurre después, sin bloquear la salida.
//
// Es la contraparte del bypass de contingencia: el mercaderista NUNCA se frena
// durante la visita, pero no sale sin haber cerrado cada hallazgo — resuelto o
// justificado. "El sistema no me va a permitir hacer checkout si yo no levanté
// toditas las incidencias… o haber puesto que no pude por X motivos."

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

/**
 * Los hallazgos que impiden salir, agrupados por marca para poder enseñarlos.
 *
 * Parte de las incidencias YA UNIDAS (`unirHallazgos`), que es donde manda la
 * fila del servidor y el derivado solo rellena el hueco. Contar declaraciones de
 * atención por su cuenta sería falsificable con un PATCH directo a PostgREST:
 * nada ata la clave de una atención a un hallazgo que exista de verdad.
 *
 * Devuelve los grupos y no un booleano porque la pantalla tiene que decir CUÁLES
 * faltan: "una validación previa… rápida, muy visual. No es que tengo que llenar
 * más cosas."
 */
export function incidenciasQueFrenan(
  incidencias: readonly IncidenciaLocal[],
): GrupoDeMarca[] {
  return agruparPorMarca(incidencias.filter(sigueSinAtender));
}

/**
 * La visita está lista para cerrar: todas las marcas auditadas Y ningún hallazgo
 * sin cerrar.
 *
 * `incidencias` es obligatorio a propósito. Con un valor por defecto, un llamador
 * que se lo olvidara obtendría la verja en VERDE — el fallo silencioso que deja
 * salir al mercaderista con hallazgos sin atender, que es justo lo que esta
 * función existe para impedir. Sin default, `tsc` obliga a decidirlo.
 */
export function puedeCerrarVisita(
  estadosLevantamiento: readonly (string | null)[],
  incidencias: readonly IncidenciaLocal[],
): boolean {
  return (
    visitaListaParaCheckOut(estadosLevantamiento) &&
    incidenciasQueFrenan(incidencias).length === 0
  );
}
