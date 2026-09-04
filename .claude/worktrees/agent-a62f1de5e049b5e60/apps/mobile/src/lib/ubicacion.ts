import type { PuntoGeo } from "@market-track/shared";
import * as Location from "expo-location";

// La ubicación del teléfono para el check-in/check-out. Se pide de UN tiro, no en
// continuo: alta precisión sostenida vacía la batería en una jornada de campo
// (CLAUDE.md → Respetar el hardware).

export type ResultadoUbicacion =
  | { ok: true; punto: PuntoGeo; precision_m: number | null }
  | { ok: false; motivo: "permiso" | "error" };

export async function ubicacionActual(): Promise<ResultadoUbicacion> {
  const permiso = await Location.requestForegroundPermissionsAsync();
  if (permiso.status !== Location.PermissionStatus.GRANTED) {
    return { ok: false, motivo: "permiso" };
  }
  try {
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return {
      ok: true,
      punto: { lat: pos.coords.latitude, lng: pos.coords.longitude },
      precision_m: pos.coords.accuracy,
    };
  } catch {
    return { ok: false, motivo: "error" };
  }
}
