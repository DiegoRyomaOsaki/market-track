import type { Metadata } from "next";

import { PantallaRanking } from "@/components/panel/ranking/pantalla-ranking";

export const metadata: Metadata = { title: "Ranking — Market Track" };

function primero(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function RankingAdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    tipo?: string | string[];
    periodo?: string | string[];
  }>;
}) {
  const params = await searchParams;
  return (
    <PantallaRanking
      esAdmin
      tipoParam={primero(params.tipo)}
      periodoParam={primero(params.periodo)}
    />
  );
}
