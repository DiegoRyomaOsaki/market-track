"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

import type { ColorPin } from "@/lib/portal/dashboard";

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

// El clic en un pin (evento de ratón de MapLibre) es la única forma de llegar a la
// galería de una tienda desde el mapa: sin teclado no hay canvas navegable. Esta
// lista da el MISMO enlace por teclado y lector de pantalla. Va oculta a la vista
// (`sr-only`) pero cada enlace se revela al recibir foco.
const ETIQUETA_ESTADO: Record<ColorPin, string> = {
  verde: "al día",
  ambar: "visita en curso",
  rojo: "requiere atención",
};

export function MapaTiendas({
  urlTiles,
  pines,
}: {
  urlTiles: string;
  pines: PinTienda[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <MapaTiendasInner urlTiles={urlTiles} pines={pines} />
      <nav aria-label="Tiendas del mapa" className="sr-only">
        <ul>
          {pines.map((p) => (
            <li key={p.id}>
              <Link
                href={`/cliente/galeria?tienda=${encodeURIComponent(p.id)}`}
                className="focus:not-sr-only focus:absolute focus:z-10 focus:rounded focus:bg-background focus:p-2 focus:underline"
              >
                {p.nombre} — {ETIQUETA_ESTADO[p.color]}. Ver evidencia
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
