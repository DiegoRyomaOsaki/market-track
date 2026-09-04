import type { Metadata } from "next";

import { VistaPrecios } from "@/components/comercial/vista-precios";
import { VistaPromociones } from "@/components/comercial/vista-promociones";
import { Pestanas } from "@/components/panel/pestanas";
import { leerPagina } from "@/lib/panel/listado";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El SKU de la query, o nada.
 *
 * Se valida la forma antes de que llegue a un `.eq()`: un valor cualquiera no
 * es una fuga —la RLS acota igual y supabase-js parametriza— pero rompe la
 * consulta con un 22P02 y la pantalla se cae con un error que no dice nada.
 */
function skuDe(v: string | string[] | undefined): string | undefined {
  const bruto = primero(v);
  return bruto && UUID.test(bruto) ? bruto : undefined;
}

export default async function PreciosPage({
  searchParams,
}: {
  searchParams: Promise<{
    vista?: string | string[];
    p?: string | string[];
    sku?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const vistaParam = primero(params.vista);
  const vista: Vista = esVista(vistaParam) ? vistaParam : "precios";
  const pagina = leerPagina(params.p);
  const sku = skuDe(params.sku);

  return (
    <div className="flex flex-col gap-4">
      <Pestanas
        items={VISTAS}
        activa={vista}
        href={(k) =>
          sku
            ? `/admin/precios?vista=${k}&sku=${sku}`
            : `/admin/precios?vista=${k}`
        }
        etiqueta="Precios o promociones"
      />

      {vista === "precios" ? (
        <VistaPrecios pagina={pagina} sku={sku} />
      ) : (
        <VistaPromociones pagina={pagina} sku={sku} />
      )}
    </div>
  );
}
