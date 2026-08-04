"use client";

import { layers, namedFlavor } from "@protomaps/basemaps";
import type { FeatureCollection } from "geojson";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { useEffect, useRef } from "react";

import { COLOR_PIN_HEX, type PinMapa } from "@/lib/mapa/pines";

import "maplibre-gl/dist/maplibre-gl.css";

// El mapa de pines (ADR-0009: tiles PMTiles). Reusa el mismo arranque que la
// geocerca del panel; aquí pinta MUCHOS pines coloreados por estado y, al hacer
// clic, muestra una mini-card con enlace al detalle.
//
// Lo comparten el dashboard del portal y el tablero del supervisor: el destino del
// pin viaja en `href`, así que este componente no conoce ninguna ruta.

const CENTRO_LIMA: [number, number] = [-77.03, -12.05];
const ZOOM_CIUDAD = 11;

const FUENTE_BASE = "protomaps";
const FUENTE_PINES = "pines";
const ASSETS = "https://protomaps.github.io/basemaps-assets";

let protocoloRegistrado = false;

function urlAbsoluta(url: string): string {
  return new URL(url, window.location.origin).toString();
}

function escapar(texto: string): string {
  return texto.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] ?? c,
  );
}

function coleccion(pines: readonly PinMapa[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: pines.map((p) => ({
      type: "Feature",
      properties: {
        nombre: p.nombre,
        id: p.id,
        href: p.href,
        hex: COLOR_PIN_HEX[p.color],
      },
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    })),
  };
}

export function MapaPinesInner({
  urlTiles,
  pines,
  textoEnlace,
  etiqueta,
}: {
  urlTiles: string;
  pines: PinMapa[];
  textoEnlace: string;
  etiqueta: string;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  const capasListas = useRef(false);
  // El handler del popup se registra una sola vez, al construir el mapa. Leer el
  // texto de una ref evita que se quede con el valor del primer render.
  const textoEnlaceRef = useRef(textoEnlace);
  textoEnlaceRef.current = textoEnlace;

  useEffect(() => {
    if (!contenedor.current || mapa.current) return;

    if (!protocoloRegistrado) {
      maplibregl.addProtocol("pmtiles", new Protocol().tile);
      protocoloRegistrado = true;
    }

    const m = new maplibregl.Map({
      container: contenedor.current,
      center: CENTRO_LIMA,
      zoom: ZOOM_CIUDAD,
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

    m.on("load", () => {
      m.addSource(FUENTE_PINES, { type: "geojson", data: coleccion(pines) });
      m.addLayer({
        id: FUENTE_PINES,
        type: "circle",
        source: FUENTE_PINES,
        paint: {
          "circle-radius": 8,
          "circle-color": ["get", "hex"],
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
        },
      });
      capasListas.current = true;
      encuadrar(m, pines);
    });

    m.on("click", FUENTE_PINES, (e) => {
      const f = e.features?.[0];
      if (!f || f.geometry.type !== "Point") return;
      const [lon, lat] = f.geometry.coordinates;
      if (lon === undefined || lat === undefined) return;
      const nombre = escapar(String(f.properties?.nombre ?? ""));
      // `href` lo arma el servidor y aquí se escapa igual que el nombre: entra
      // como atributo de un HTML construido a mano.
      const href = escapar(String(f.properties?.href ?? ""));
      new maplibregl.Popup({ closeButton: true, offset: 12 })
        .setLngLat([lon, lat])
        .setHTML(
          `<div style="font-size:13px"><div style="font-weight:700;margin-bottom:4px">${nombre}</div>` +
            `<a href="${href}" style="color:#4f46e5;text-decoration:underline">${escapar(textoEnlaceRef.current)}</a></div>`,
        )
        .addTo(m);
    });
    m.on("mouseenter", FUENTE_PINES, () => {
      m.getCanvas().style.cursor = "pointer";
    });
    m.on("mouseleave", FUENTE_PINES, () => {
      m.getCanvas().style.cursor = "";
    });

    return () => {
      m.remove();
      mapa.current = null;
      capasListas.current = false;
    };
    // Se reconstruye solo si cambia el mapa base; los pines los actualiza el efecto
    // de abajo sin rehacer el mapa.
  }, [urlTiles]);

  useEffect(() => {
    const m = mapa.current;
    if (!m || !capasListas.current) return;
    const fuente = m.getSource<maplibregl.GeoJSONSource>(FUENTE_PINES);
    fuente?.setData(coleccion(pines));
    encuadrar(m, pines);
  }, [pines]);

  return (
    <div
      ref={contenedor}
      role="application"
      aria-label={etiqueta}
      className="h-[440px] w-full overflow-hidden rounded-xl border border-border"
    />
  );
}

/** Encuadra el mapa a los pines; con uno solo, centra sin acercar de más. */
function encuadrar(m: maplibregl.Map, pines: readonly PinMapa[]) {
  if (pines.length === 0) return;
  if (pines.length === 1) {
    const p = pines[0];
    if (p) m.easeTo({ center: [p.lon, p.lat], zoom: 14 });
    return;
  }
  const limites = new maplibregl.LngLatBounds();
  for (const p of pines) limites.extend([p.lon, p.lat]);
  m.fitBounds(limites, { padding: 48, maxZoom: 14, duration: 0 });
}
