/**
 * Lee un campo de texto de un FormData, ya recortado.
 *
 * `FormData.get` devuelve `string | File | null`: un `String(...)` directo
 * convertiría un archivo en `"[object File]"` y lo mandaría al servidor como si
 * fuera lo que el usuario escribió. Lo que no sea texto no es texto.
 */
export function leerCampo(fd: FormData, clave: string): string {
  const valor = fd.get(clave);
  return typeof valor === "string" ? valor.trim() : "";
}

/** ¿Está marcada la casilla? Un checkbox ausente no viaja en el FormData. */
export function leerCasilla(fd: FormData, clave: string): boolean {
  return fd.get(clave) === "on";
}
