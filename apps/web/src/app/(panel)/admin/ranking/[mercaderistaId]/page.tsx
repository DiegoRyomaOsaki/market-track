import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { DetalleMercaderista } from "@/components/panel/ranking/detalle-mercaderista";
import { periodoPuntajeSchema } from "@market-track/shared";
import { diaEnLima } from "@/lib/fecha-lima";
import { esFechaISO, inicioDePeriodo } from "@/lib/ranking/ranking";

export const metadata: Metadata = {
  title: "Detalle del ranking — Market Track",
};

function primero(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function DetalleRankingAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ mercaderistaId: string }>;
  searchParams: Promise<{
    tipo?: string | string[];
    periodo?: string | string[];
  }>;
}) {
  const { mercaderistaId } = await params;
  // Antes de tocar la base: un id basura en la URL no es una consulta, es un
  // 404 tipado.
  if (!z.guid().safeParse(mercaderistaId).success) notFound();

  const sp = await searchParams;
  const tipoParam = periodoPuntajeSchema.safeParse(primero(sp.tipo));
  const tipo = tipoParam.success ? tipoParam.data : "mensual";
  const periodoParam = primero(sp.periodo);
  const inicio = inicioDePeriodo(
    tipo,
    periodoParam !== undefined && esFechaISO(periodoParam)
      ? periodoParam
      : diaEnLima(new Date()),
  );

  return (
    <DetalleMercaderista
      esAdmin
      mercaderistaId={mercaderistaId}
      tipo={tipo}
      inicio={inicio}
    />
  );
}
