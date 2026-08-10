import { COLUMNAS, HOJAS } from "./plantilla";
import { construirXlsx, type HojaXlsx } from "./xlsx";

// El .xlsx vacío que el admin descarga, le manda al cliente y el cliente rellena.
//
// Se GENERA desde `COLUMNAS`, no se guarda como archivo estático en `public/`.
// Un binario en el repo sería una segunda copia del formato: el día que se añada
// una columna, el importador la esperaría y la plantilla no la traería, y el
// cliente descubriría el desfase con el archivo ya lleno.

export const NOMBRE_PLANTILLA = "maestro-comercial-market-track.xlsx";

/**
 * Solo cabeceras: una hoja por entidad, una columna por campo.
 *
 * Sin filas de ejemplo a propósito. Una fila de muestra dentro de la hoja se
 * queda ahí —nadie borra lo que parece parte de la plantilla— y entraría al
 * maestro como una tienda inventada en la primera importación.
 */
export function construirPlantilla(): Buffer {
  const hojas: HojaXlsx[] = HOJAS.map((hoja) => ({
    nombre: hoja,
    filas: [[...COLUMNAS[hoja]]],
  }));
  return construirXlsx(hojas);
}
