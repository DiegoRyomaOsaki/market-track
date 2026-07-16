// Geometría de la geocerca. Vive aquí, fuera de la UI, porque no es dibujo: es
// la regla que decide si un mercaderista puede hacer check-in en una tienda.

const RADIO_TIERRA_M = 6_371_008.8; // radio medio (IUGG)
const LADOS = 64;

function esFinito(v: number): boolean {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * La ubicación en el formato que entiende PostGIS por PostgREST.
 *
 * **El orden es POINT(lon lat)**, no (lat lon): PostGIS habla en X Y. Invertirlo
 * no da ningún error — solo coloca la tienda en otro continente.
 *
 * Se escribe SIEMPRE `ubicacion`, nunca `lat`/`lon`: son columnas GENERADAS. Los
 * tipos que genera Supabase las ofrecen en `Insert`/`Update` de todos modos, pero
 * Postgres las rechaza en runtime ("can only be updated to DEFAULT").
 */
export function puntoEwkt(lat: number, lon: number): string {
  if (!esFinito(lat) || !esFinito(lon)) {
    throw new Error("Coordenadas inválidas");
  }
  if (lat < -90 || lat > 90) throw new Error("Latitud fuera de rango");
  if (lon < -180 || lon > 180) throw new Error("Longitud fuera de rango");
  return `SRID=4326;POINT(${lon} ${lat})`;
}

/** Distancia entre dos puntos por la fórmula del haversine. */
export function distanciaMetros(
  latA: number,
  lonA: number,
  latB: number,
  lonB: number,
): number {
  const aRad = (g: number) => (g * Math.PI) / 180;
  const dLat = aRad(latB - latA);
  const dLon = aRad(lonB - lonA);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aRad(latA)) * Math.cos(aRad(latB)) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type PoligonoGeoJSON = {
  type: "Polygon";
  coordinates: [number, number][][];
};

/**
 * El círculo de la geocerca como polígono real, en metros sobre el terreno.
 *
 * No se pinta con un `circle-radius` de MapLibre: ese radio va en PÍXELES, así
 * que habría que reconvertirlo en cada zoom y seguiría sin corregir por latitud.
 * Un polígono en coordenadas mide lo que dice a cualquier zoom.
 */
export function circuloGeocerca(
  lat: number,
  lon: number,
  radioM: number,
  lados = LADOS,
): PoligonoGeoJSON {
  if (!esFinito(radioM) || radioM <= 0) {
    throw new Error("El radio de la geocerca tiene que ser mayor que 0");
  }

  const gradosLat = (radioM / RADIO_TIERRA_M) * (180 / Math.PI);
  // Un grado de longitud se encoge con el coseno de la latitud: sin esto el
  // círculo sale ovalado, y cuanto más lejos del ecuador, peor.
  const gradosLon = gradosLat / Math.cos((lat * Math.PI) / 180);

  const anillo: [number, number][] = [];
  for (let i = 0; i <= lados; i++) {
    const angulo = (i / lados) * 2 * Math.PI;
    anillo.push([
      lon + gradosLon * Math.cos(angulo),
      lat + gradosLat * Math.sin(angulo),
    ]);
  }
  return { type: "Polygon", coordinates: [anillo] };
}
