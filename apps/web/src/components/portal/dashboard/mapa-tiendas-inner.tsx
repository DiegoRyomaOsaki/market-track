"use client";

import { layers, namedFlavor } from "@protomaps/basemaps";
import type { FeatureCollection } from "geojson";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { useEffect, useRef } from "react";

import type { ColorPin } from "@/lib/portal/dashboard";

import "maplibre-gl/dist/maplibre-gl.css";

// El mapa de tiendas del dashboard (MAR-55, ADR-0009: tiles PMTiles). Reusa el
// mismo arranque que la geocerca del panel; aquí pinta MUCHOS pines coloreados por
// estado y, al hacer clic, muestra una mini-card con enlace a la tienda.

export type PinTienda = {
  id: string;
  nombre: string;
  lat: number;
  lon: number;
  color: ColorPin;
};

const CENTRO_LIMA: [number, number] = [-77.03, -12.05];
const ZOOM_CIUDAD = 11;

const FUENTE_BASE = "protomaps";
const FUENTE_PINES = "pines";
const ASSETS = "https://protomaps.github.io/basemaps-assets";

const COLOR_HEX: Record<ColorPin, string> = {
  verde: "#16a34a",
  ambar: "#d97706",
  rojo: "#dc2626",
};

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

function coleccion(pines: readonly PinTienda[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: pines.map((p) => ({
      type: "Feature",
      properties: { nombre: p.nombre, id: p.id, hex: COLOR_HEX[p.color] },
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    })),
  };
}

export function MapaTiendasInner({
  urlTiles,
  pines,
}: {
  urlTiles: string;
  pines: PinTienda[];
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  const capasListas = useRef(false);

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
      const id = String(f.properties?.id ?? "");
      new maplibregl.Popup({ closeButton: true, offset: 12 })
        .setLngLat([lon, lat])
        .setHTML(
          `<div style="font-size:13px"><div style="font-weight:700;margin-bottom:4px">${nombre}</div>` +
            `<a href="/cliente/galeria?tienda=${encodeURIComponent(id)}" style="color:#4f46e5;text-decoration:underline">Ver evidencia</a></div>`,
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
      aria-label="Mapa de tiendas por estado"
      className="h-[440px] w-full overflow-hidden rounded-xl border border-border"
    />
  );
}

/** Encuadra el mapa a los pines; con uno solo, centra sin acercar de más. */
function encuadrar(m: maplibregl.Map, pines: readonly PinTienda[]) {
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
