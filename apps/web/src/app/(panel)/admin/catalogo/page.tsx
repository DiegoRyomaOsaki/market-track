import type { Metadata } from "next";

import { VistaCategorias } from "@/components/catalogo/vista-categorias";
import { VistaCodificados } from "@/components/catalogo/vista-codificados";
import { VistaSkus } from "@/components/catalogo/vista-skus";
import { VistaTiendas } from "@/components/catalogo/vista-tiendas";
import { Pestanas } from "@/components/panel/pestanas";
import { leerPagina } from "@/lib/panel/listado";

export const metadata: Metadata = { title: "Catálogo — Market Track" };

// El maestro comercial en cuatro caras: tiendas y cadenas, SKUs, categorías y la
// matriz de codificados. El catálogo entra sobre todo por la importación del Excel del
// cliente (MAR-29/45); estas pantallas son para correcciones y casos puntuales.

const VISTAS = [
  { key: "tiendas", label: "Tiendas y cadenas" },
  { key: "skus", label: "SKUs" },
  { key: "categorias", label: "Categorías" },
  { key: "codificados", label: "Codificados" },
] as const;

type Vista = (typeof VISTAS)[number]["key"];

function esVista(v: string | undefined): v is Vista {
  return VISTAS.some((x) => x.key === v);
}

function primero(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<{
    vista?: string | string[];
    q?: string | string[];
    tienda?: string | string[];
    p?: string | string[];
    pc?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const vistaParam = primero(params.vista);
  const vista: Vista = esVista(vistaParam) ? vistaParam : "tiendas";
  const busqueda = (primero(params.q) ?? "").trim();
  const tienda = primero(params.tienda);
  const pagina = leerPagina(params.p);
  const paginaCadenas = leerPagina(params.pc);

  return (
    <div className="flex flex-col gap-4">
      <Pestanas
        items={VISTAS}
        activa={vista}
        href={(k) => `/admin/catalogo?vista=${k}`}
        etiqueta="Sección del catálogo"
      />

      {vista === "tiendas" && (
        <VistaTiendas
          busqueda={busqueda}
          pagina={pagina}
          paginaCadenas={paginaCadenas}
        />
      )}
      {vista === "skus" && <VistaSkus busqueda={busqueda} pagina={pagina} />}
      {vista === "categorias" && (
        <VistaCategorias busqueda={busqueda} pagina={pagina} />
      )}
      {vista === "codificados" && <VistaCodificados tiendaId={tienda} />}
    </div>
  );
}
