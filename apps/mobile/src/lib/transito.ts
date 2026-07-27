import * as FileSystem from "expo-file-system/legacy";

// Modo tránsito: el tiempo de traslado ENTRE tiendas. El cronómetro arranca al
// hacer check-out de una tienda y se cierra al hacer check-in en la siguiente,
// donde los minutos quedan en `visita.tiempo_traslado_min` de la visita que
// llega (el traslado es "hacia" la tienda a la que se entra).
//
// Se persiste en disco: un traslado puede cruzar un cierre de la app o un tramo
// sin señal, como todo lo demás en el offline-first.

const RUTA = `${FileSystem.documentDirectory}transito.json`;

export async function iniciarTransito(desdeIso: string): Promise<void> {
  await FileSystem.writeAsStringAsync(RUTA, JSON.stringify({ desde: desdeIso }));
}

export async function leerTransito(): Promise<string | null> {
  const info = await FileSystem.getInfoAsync(RUTA);
  if (!info.exists) return null;
  try {
    const datos: unknown = JSON.parse(await FileSystem.readAsStringAsync(RUTA));
    const desde = (datos as { desde?: unknown }).desde;
    return typeof desde === "string" ? desde : null;
  } catch {
    return null;
  }
}

export async function limpiarTransito(): Promise<void> {
  await FileSystem.deleteAsync(RUTA, { idempotent: true });
}

/** Minutos redondeados de traslado entre dos instantes ISO (nunca negativo). */
export function minutosDeTraslado(desdeIso: string, hastaIso: string): number {
  const ms = new Date(hastaIso).getTime() - new Date(desdeIso).getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.round(ms / 60000));
}
