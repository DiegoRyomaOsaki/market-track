import type { PuntoGeo } from "@market-track/shared";

// Utilidades de geolocalización del móvil.
//
// OJO: el chequeo de geocerca en el cliente es SOLO UX (ADR-0001). La seguridad
// está en el servidor, que re-valida con PostGIS al sincronizar (MAR-30). Aquí
// solo se decide si mostrar "estás en la tienda" antes del check-in.

const RADIO_TIERRA_M = 6_371_000;

const aRadianes = (grados: number) => (grados * Math.PI) / 180;

/** Distancia haversine en metros entre dos puntos (lat/lon en grados). */
export function distanciaMetros(
  latA: number,
  lonA: number,
  latB: number,
  lonB: number,
): number {
  const dLat = aRadianes(latB - latA);
  const dLon = aRadianes(lonB - lonA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aRadianes(latA)) *
      Math.cos(aRadianes(latB)) *
      Math.sin(dLon / 2) ** 2;
  return RADIO_TIERRA_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type Geocerca = {
  lat: number | null;
  lon: number | null;
  radio_m: number | null;
};

/**
 * ¿El punto actual cae dentro del radio de geocerca de la tienda? Solo UX.
 * Si la tienda no tiene ubicación o radio, no se puede decidir → null (el
 * servidor tendrá la última palabra igual).
 */
export function dentroDeGeocerca(
  actual: PuntoGeo,
  tienda: Geocerca,
): boolean | null {
  if (tienda.lat == null || tienda.lon == null || tienda.radio_m == null) {
    return null;
  }
  const d = distanciaMetros(actual.lat, actual.lng, tienda.lat, tienda.lon);
  return d <= tienda.radio_m;
}

/**
 * El punto del teléfono en EWKT para la columna `geography` de Postgres.
 * PostGIS es `POINT(lon lat)` — el orden inverso al humano.
 */
export function puntoAEwkt(p: PuntoGeo): string {
  return `SRID=4326;POINT(${p.lng} ${p.lat})`;
}
