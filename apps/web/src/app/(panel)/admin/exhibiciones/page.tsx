import type { Metadata } from "next";

import { VistaExhibiciones } from "@/components/comercial/vista-exhibiciones";
import { leerPagina } from "@/lib/panel/listado";

export const metadata: Metadata = {
  title: "Exhibiciones negociadas — Market Track",
};

export default async function ExhibicionesPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string | string[] }>;
}) {
  const params = await searchParams;
  return <VistaExhibiciones pagina={leerPagina(params.p)} />;
}
