import leerExcel from "read-excel-file/node";

import { type Hoja, HOJAS, TOPE_BYTES } from "./plantilla";
import type { HojasCrudas } from "./validacion";

// De un .xlsx a una matriz de celdas por hoja. Nada más: la validación es otro
// archivo, y la librería solo se usa para leer.
//
// `read-excel-file` está FIJADA en 5.8.8, no en la última. La 9.x revienta con
// `readFiles(...).then is not a function` en todo .xlsx sin `xl/sharedStrings.xml`
// —el que produce Apache POI en modo streaming, o sea el exportador típico de un
// ERP—. Hay un test con ese formato exacto: es la red para poder subir de versión.

export type ResultadoParseo =
  { ok: true; hojas: HojasCrudas } | { ok: false; error: string };

/**
 * Lee el maestro. Un archivo ilegible es un error de datos, no una excepción:
 * lo normal es que alguien suba un .pdf renombrado o el .xlsx equivocado.
 */
export async function parsearMaestro(
  archivo: Buffer,
): Promise<ResultadoParseo> {
  // Un .xlsx es un zip: la descompresión ocurre antes de poder contar filas, así
  // que el tope de bytes es la única defensa contra un archivo que se expande.
  if (archivo.byteLength > TOPE_BYTES) {
    return {
      ok: false,
      error: `El archivo pesa más de ${Math.round(TOPE_BYTES / 1024 / 1024)} MB`,
    };
  }

  const hojas: HojasCrudas = {};
  let algunaLeida = false;

  for (const hoja of HOJAS) {
    try {
      const filas = await leerExcel(archivo, { sheet: hoja });
      hojas[hoja] = filas;
      algunaLeida = true;
    } catch (err) {
      // Una hoja ausente no es un fallo: el cliente puede no mandar promociones.
      // Cualquier otro error sí, y se distingue por el mensaje de la librería.
      if (esHojaAusente(err)) continue;
      return { ok: false, error: mensajeDeArchivo(err) };
    }
  }

  if (!algunaLeida) {
    return {
      ok: false,
      error: `El archivo no tiene ninguna de las hojas esperadas: ${HOJAS.join(", ")}`,
    };
  }

  return { ok: true, hojas };
}

function esHojaAusente(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /sheet.*not found|no such sheet/i.test(m);
}

function mensajeDeArchivo(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  // El mensaje de la librería habla de zips y XML: no le dice nada al operador,
  // y puede arrastrar contenido del archivo. Se registra, no se devuelve.
  console.error("[importacion] parseo", m.slice(0, 200));
  return "No pudimos leer el archivo. Comprueba que sea un Excel (.xlsx) válido.";
}

/** Las hojas que el archivo trajo de verdad. Para el resumen de la pantalla. */
export function hojasPresentes(hojas: HojasCrudas): Hoja[] {
  return HOJAS.filter((h) => hojas[h] !== undefined);
}
