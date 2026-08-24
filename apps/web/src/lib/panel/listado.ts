// La paginación de los listados del panel.
//
// `precio_regular` NUNCA sobreescribe: la fecha de vigencia forma parte de su
// clave, así que cada corrección deja una fila más y ninguna se retira. La
// tabla solo crece, y una consulta sin cota acaba trayendo el histórico entero
// para pintar la primera pantalla. Lo mismo, con menos prisa, le pasa a todo
// maestro que importa 5.000 filas por hoja de Excel.
//
// Se pagina con `range` y una fila de sonda, SIN contar la tabla: un
// `count: "exact"` recorre el conjunto entero que la política deja ver — el
// mismo costo que la paginación elimina. Por eso no hay "página 3 de 47" ni
// salto a la última: solo anterior y siguiente.

export const TAMANO_PAGINA = 50;

/** El tope de página aceptado: por encima, el OFFSET vuelve a ser un scan. */
const PAGINA_MAX = 200;

/** El número de página del query param, o 1 si no es un entero razonable. */
export function leerPagina(v: string | string[] | undefined): number {
  const crudo = Array.isArray(v) ? v[0] : v;
  const n = Number(crudo);
  if (!Number.isInteger(n) || n < 1 || n > PAGINA_MAX) return 1;
  return n;
}

/**
 * El rango para `.range(desde, hasta)` — ambos inclusivos. Pide una fila de
 * más que la página para saber si hay siguiente sin contar la tabla.
 */
export function rangoDe(pagina: number): [number, number] {
  const desde = (pagina - 1) * TAMANO_PAGINA;
  return [desde, desde + TAMANO_PAGINA];
}

export type Paginado<T> = {
  filas: T[];
  hayAnterior: boolean;
  haySiguiente: boolean;
  /**
   * Página > 1 sin filas: la página dejó de existir, no los datos. Sin esta
   * rama, el estado vacío de siempre («aún no hay…») se pintaría sobre una
   * tabla llena.
   */
  vaciaFueraDeRango: boolean;
};

export function paginar<T>(filas: T[], pagina: number): Paginado<T> {
  const haySiguiente = filas.length > TAMANO_PAGINA;
  return {
    filas: haySiguiente ? filas.slice(0, TAMANO_PAGINA) : filas,
    hayAnterior: pagina > 1,
    haySiguiente,
    vaciaFueraDeRango: pagina > 1 && filas.length === 0,
  };
}

/**
 * Escapa un término antes de interpolarlo en un patrón `ilike`.
 *
 * `%` y `_` son comodines del patrón, y la coma y los paréntesis parten la
 * gramática de un `.or(...)` de PostgREST: sin esto, buscar «1,5L» añade un
 * filtro inexistente en vez de buscar la cadena. Los separadores de gramática
 * no admiten escape dentro del valor, así que se sustituyen por un espacio.
 */
export function escaparPatronIlike(termino: string): string {
  return termino
    .replace(/[\\%_]/g, (c) => `\\${c}`)
    .replace(/[(),]/g, " ")
    .trim();
}
