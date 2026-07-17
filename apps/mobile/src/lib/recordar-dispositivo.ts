import * as SecureStore from "expo-secure-store";

// "Recordar este dispositivo por 30 días" (ADR-0008 / MAR-34).
//
// Descansa en un hecho verificado: una sesión que llegó a `aal2` RETIENE el aal2
// al refrescarse (el claim del JWT nuevo sigue diciendo aal2). Así que recordar
// el dispositivo no es "saltarse el 2FA" —eso sería el muro de MAR-66, llegar a
// aal2 sin OTP— sino no volver a PEDIRLO mientras la sesión persistida siga viva
// y dentro de la ventana.
//
// Se guarda solo una marca de tiempo (hasta cuándo vale), no un secreto: quien
// tenga el teléfono desbloqueado ya tiene la sesión de SecureStore.

const CLAVE = "recordado_hasta";
const DIAS = 30;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Hasta cuándo vale este dispositivo, en ms epoch. `recordar=false` no lo extiende. */
export function calcularVentana(ahora: number, recordar: boolean): number {
  return recordar ? ahora + DIAS * MS_POR_DIA : ahora;
}

/** ¿Sigue dentro de la ventana? Sin marca guardada, no. */
export function dispositivoVigente(
  hasta: number | null,
  ahora: number,
): boolean {
  return hasta !== null && ahora < hasta;
}

export async function guardarVentana(hasta: number): Promise<void> {
  await SecureStore.setItemAsync(CLAVE, String(hasta));
}

export async function leerVentana(): Promise<number | null> {
  const v = await SecureStore.getItemAsync(CLAVE);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function olvidarDispositivo(): Promise<void> {
  await SecureStore.deleteItemAsync(CLAVE);
}
