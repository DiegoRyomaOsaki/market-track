/**
 * El mensaje de un fallo, acotado y seguro para registrar.
 *
 * Dos cosas en una línea, y las dos son reglas del proyecto: un `Error` de un
 * cliente de infraestructura puede arrastrar contenido de la respuesta —incluso
 * credenciales— en su `.message`, así que se recorta antes de que llegue al log;
 * y un valor que no es `Error` no debe reventar el registro.
 */
export function mensajeDeError(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200);
}
