"use client";

import { layers, namedFlavor } from "@protomaps/basemaps";
import type { FeatureCollection } from "geojson";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { useEffect, useRef } from "react";

import { circuloGeocerca } from "@/lib/mapa/geo";

import "maplibre-gl/dist/maplibre-gl.css";

// El mapa para fijar la ubicación y la geocerca de una tienda (ADR-0009: tiles
// PMTiles autohospedados). Es la hoja interactiva y nada más: no sabe de
// formularios ni de Supabase — recibe punto y radio, y avisa cuando se mueve.

const CENTRO_LIMA: [number, number] = [-77.03, -12.05];
const ZOOM_CIUDAD = 11;
const ZOOM_TIENDA = 16;

const FUENTE_BASE = "protomaps";
const FUENTE_GEOCERCA = "geocerca";
const FUENTE_PUNTO = "punto";

// Los assets del estilo (fuentes tipográficas y sprites) no salen del PMTiles.
const ASSETS = "https://protomaps.github.io/basemaps-assets";

let protocoloRegistrado = false;

/** `pmtiles://` no resuelve rutas relativas: hay que darle una URL absoluta. */
function urlAbsoluta(url: string): string {
  return new URL(url, window.location.origin).toString();
}

export function MapaGeocerca({
  lat,
  lon,
  radioM,
  urlTiles,
  onMover,
}: {
  lat: number | null;
  lon: number | null;
  radioM: number;
  urlTiles: string;
  onMover: (lat: number, lon: number) => void;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  // Nuestras capas están puestas. NO se usa `isStyleLoaded()` para esto: eso
  // responde "¿está todo el estilo y sus tiles cargados AHORA MISMO?", y se pone
  // en false mientras el mapa trae tiles — o se queda en false para siempre si el
  // extracto no llega al zoom actual (el de Lima acaba en z14 y la ficha de
  // tienda trabaja a z16). Usarlo como guard se traga los cambios de radio sin un
  // solo error: el círculo deja de seguir al número.
  const capasListas = useRef(false);
  // La tienda que ya venía ubicada se encuadra al abrir; la nueva, al marcarla.
  const yaEncuadrado = useRef(lat !== null && lon !== null);
  // El callback vive en una ref: si fuera dependencia del efecto, el mapa se
  // reconstruiría entero en cada render del formulario.
  const alMover = useRef(onMover);
  alMover.current = onMover;

  useEffect(() => {
    if (!contenedor.current || mapa.current) return;

    if (!protocoloRegistrado) {
      maplibregl.addProtocol("pmtiles", new Protocol().tile);
      protocoloRegistrado = true;
    }

    const m = new maplibregl.Map({
      container: contenedor.current,
      center: lat !== null && lon !== null ? [lon, lat] : CENTRO_LIMA,
      zoom: lat !== null && lon !== null ? ZOOM_TIENDA : ZOOM_CIUDAD,
      style: {
        version: 8,
        glyphs: `${ASSETS}/fonts/{fontstack}/{range}.pbf`,
        sprite: `${ASSETS}/sprites/v4/light`,
        sources: {
          [FUENTE_BASE]: {
            type: "vector",
            url: `pmtiles://${urlAbsoluta(urlTiles)}`,
            attribution: "Protomaps © OpenStreetMap",
          },
        },
        layers: layers(FUENTE_BASE, namedFlavor("light"), { lang: "es" }),
      },
    });
    mapa.current = m;

    m.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    m.on("click", (e) => alMover.current(e.lngLat.lat, e.lngLat.lng));

    m.on("load", () => {
      m.addSource(FUENTE_GEOCERCA, { type: "geojson", data: vacio() });
      m.addLayer({
        id: "geocerca-relleno",
        type: "fill",
        source: FUENTE_GEOCERCA,
        paint: { "fill-color": "#4f46e5", "fill-opacity": 0.15 },
      });
      m.addLayer({
        id: "geocerca-borde",
        type: "line",
        source: FUENTE_GEOCERCA,
        paint: { "line-color": "#4f46e5", "line-width": 2 },
      });
      m.addSource(FUENTE_PUNTO, { type: "geojson", data: vacio() });
      m.addLayer({
        id: "punto-tienda",
        type: "circle",
        source: FUENTE_PUNTO,
        paint: {
          "circle-radius": 7,
          "circle-color": "#4f46e5",
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
        },
      });
      capasListas.current = true;
      pintar(m, lat, lon, radioM);
    });

    return () => {
      m.remove();
      mapa.current = null;
      capasListas.current = false;
    };
    // Se monta una vez y se reconstruye solo si cambia el mapa base: el punto y el
    // radio los aplica el efecto de abajo, sin rehacer el mapa en cada tecla.
  }, [urlTiles]);

  useEffect(() => {
    const m = mapa.current;
    if (!m || !capasListas.current) return;
    pintar(m, lat, lon, radioM);

    // Al marcar la tienda desde el zoom de ciudad, la geocerca es invisible: 100 m
    // son ~2 píxeles a z11. Sin acercar, el supervisor fija un radio que no puede
    // ver. Solo la primera vez: después manda él, y pelearle el zoom sería peor.
    if (lat === null || lon === null || yaEncuadrado.current) return;
    yaEncuadrado.current = true;
    if (m.getZoom() < ZOOM_TIENDA) {
      m.easeTo({ center: [lon, lat], zoom: ZOOM_TIENDA });
    }
  }, [lat, lon, radioM]);

  return (
    <div
      ref={contenedor}
      role="application"
      aria-label="Mapa para fijar la ubicación de la tienda"
      className="h-[340px] w-full overflow-hidden rounded-xl border border-border"
    />
  );
}

function vacio(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function pintar(
  m: maplibregl.Map,
  lat: number | null,
  lon: number | null,
  radioM: number,
) {
  // Con el genérico, no con un `as`: `getSource` devuelve `Source`, que no sabe
  // de setData.
  const geocerca = m.getSource<maplibregl.GeoJSONSource>(FUENTE_GEOCERCA);
  const punto = m.getSource<maplibregl.GeoJSONSource>(FUENTE_PUNTO);
  if (!geocerca || !punto) return;

  if (lat === null || lon === null) {
    geocerca.setData(vacio());
    punto.setData(vacio());
    return;
  }

  punto.setData({
    type: "Feature",
    properties: {},
    geometry: { type: "Point", coordinates: [lon, lat] },
  });

  // Un radio inválido no debe romper el mapa: el formulario ya lo está avisando.
  if (!Number.isFinite(radioM) || radioM <= 0) {
    geocerca.setData(vacio());
    return;
  }
  geocerca.setData({
    type: "Feature",
    properties: {},
    geometry: circuloGeocerca(lat, lon, radioM),
  });
}
