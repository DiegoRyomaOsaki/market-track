// El tope de filas de las tablas comerciales.
//
// `precio_regular` NUNCA sobreescribe: la fecha de vigencia forma parte de su
// clave, así que cada corrección de precio deja una fila más y ninguna se retira.
// La tabla solo crece, y una consulta sin cota acaba trayendo el histórico entero
// para pintar la primera pantalla.
//
// El tope no es paginación —el panel entero está sin paginar y eso es un
// problema aparte, más grande que este módulo—, pero sí evita el caso peor y,
// sobre todo, DICE cuando ha recortado: un corte silencioso se lee como "esto es
// todo lo que hay".

export const TOPE_LISTADO = 200;

/** Pide una fila de más para saber si hay más sin contar la tabla entera. */
export const TOPE_CONSULTA = TOPE_LISTADO + 1;

export function acotar<T>(filas: T[]): { filas: T[]; hayMas: boolean } {
  const hayMas = filas.length > TOPE_LISTADO;
  return { filas: hayMas ? filas.slice(0, TOPE_LISTADO) : filas, hayMas };
}
