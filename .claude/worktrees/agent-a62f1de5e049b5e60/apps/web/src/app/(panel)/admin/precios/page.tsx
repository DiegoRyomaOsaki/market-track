import type { Metadata } from "next";

import { VistaPrecios } from "@/components/comercial/vista-precios";
import { VistaPromociones } from "@/components/comercial/vista-promociones";
import { Pestanas } from "@/components/panel/pestanas";

export const metadata: Metadata = {
  title: "Precios y promociones — Market Track",
};

// Precios regulares y promociones en dos caras de la misma pantalla: son el par
// que el motor de alertas compara contra lo que el mercaderista levanta en
// góndola, y se consultan juntos.

const VISTAS = [
  { key: "precios", label: "Precios regulares" },
  { key: "promociones", label: "Promociones" },
] as const;

type Vista = (typeof VISTAS)[number]["key"];

function esVista(v: string | undefined): v is Vista {
  return VISTAS.some((x) => x.key === v);
}

function primero(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function PreciosPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string | string[] }>;
}) {
  const params = await searchParams;
  const vistaParam = primero(params.vista);
  const vista: Vista = esVista(vistaParam) ? vistaParam : "precios";

  return (
    <div className="flex flex-col gap-4">
      <Pestanas
        items={VISTAS}
        activa={vista}
        href={(k) => `/admin/precios?vista=${k}`}
        etiqueta="Precios o promociones"
      />

      {vista === "precios" ? <VistaPrecios /> : <VistaPromociones />}
    </div>
  );
}
