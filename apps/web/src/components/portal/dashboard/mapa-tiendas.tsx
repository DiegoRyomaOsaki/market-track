"use client";

import dynamic from "next/dynamic";

import type { PinTienda } from "./mapa-tiendas-inner";

// El mapa solo tiene sentido en el navegador (MapLibre + WebGL): se carga con
// `ssr: false`, que solo se permite dentro de un client component — de ahí este
// envoltorio. Igual que hace el mapa de la geocerca en el panel.
const MapaTiendasInner = dynamic(
  () => import("./mapa-tiendas-inner").then((m) => m.MapaTiendasInner),
  {
    ssr: false,
    loading: () => (
      <div className="h-[440px] w-full animate-pulse rounded-xl border border-border bg-muted" />
    ),
  },
);

export function MapaTiendas({
  urlTiles,
  pines,
}: {
  urlTiles: string;
  pines: PinTienda[];
}) {
  return <MapaTiendasInner urlTiles={urlTiles} pines={pines} />;
}
