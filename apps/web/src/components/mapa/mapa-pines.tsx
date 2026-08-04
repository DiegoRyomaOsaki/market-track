"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

import type { PinMapa } from "@/lib/mapa/pines";

// El mapa solo tiene sentido en el navegador (MapLibre + WebGL): se carga con
// `ssr: false`, que solo se permite dentro de un client component — de ahí este
// envoltorio. Igual que hace el mapa de la geocerca en el panel.
//
// Lo comparten el dashboard del portal y el tablero del supervisor. Lo que cambia
// entre pantallas viaja EN LOS DATOS (el `href` y la `descripcion` de cada pin,
// más el texto del enlace), nunca en una función: así el mapa no conoce ninguna
// pantalla y las props se pueden armar en un Server Component.
const MapaPinesInner = dynamic(
  () => import("./mapa-pines-inner").then((m) => m.MapaPinesInner),
  {
    ssr: false,
    loading: () => (
      <div className="h-[440px] w-full animate-pulse rounded-xl border border-border bg-muted" />
    ),
  },
);

export function MapaPines({
  urlTiles,
  pines,
  textoEnlace,
  etiqueta,
}: {
  urlTiles: string;
  pines: PinMapa[];
  /** Qué dice el enlace de cada pin, p. ej. "Ver evidencia". */
  textoEnlace: string;
  /** El nombre accesible del mapa y de su lista equivalente. */
  etiqueta: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <MapaPinesInner
        urlTiles={urlTiles}
        pines={pines}
        textoEnlace={textoEnlace}
        etiqueta={etiqueta}
      />
      {/* El clic en un pin (evento de ratón de MapLibre) es la única forma de
          llegar al detalle desde el mapa: sin teclado no hay canvas navegable.
          Esta lista da el MISMO enlace por teclado y lector de pantalla. Va
          oculta a la vista pero cada enlace se revela al recibir foco. */}
      <nav aria-label={etiqueta} className="sr-only">
        <ul>
          {pines.map((p) => (
            <li key={p.id}>
              <Link
                href={p.href}
                className="focus:not-sr-only focus:absolute focus:z-10 focus:rounded focus:bg-background focus:p-2 focus:underline"
              >
                {p.nombre} — {p.descripcion}. {textoEnlace}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
