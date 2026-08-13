import type { Metadata } from "next";

import {
  PantallaMetricas,
  type VistaMetricas,
  VISTAS,
} from "@/components/panel/metricas/pantalla-metricas";

export const metadata: Metadata = { title: "Métricas y bonos — Market Track" };

function primero(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function esVista(v: string | undefined): v is VistaMetricas {
  return VISTAS.some((x) => x.key === v);
}

export default async function MetricasAdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    vista?: string | string[];
    marca?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const vistaParam = primero(params.vista);
  return (
    <PantallaMetricas
      esAdmin
      vista={esVista(vistaParam) ? vistaParam : "perfect-store"}
      marcaId={primero(params.marca) ?? null}
    />
  );
}
