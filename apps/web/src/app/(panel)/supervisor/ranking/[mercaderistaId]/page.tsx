import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { DetalleMercaderista } from "@/components/panel/ranking/detalle-mercaderista";
import {
  esFechaISO,
  inicioDePeriodo,
  periodoPuntajeSchema,
} from "@market-track/shared";
import { diaEnLima } from "@/lib/fecha-lima";

export const metadata: Metadata = {
  title: "Detalle del ranking — Market Track",
};

function primero(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function DetalleRankingSupervisorPage({
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
      esAdmin={false}
      mercaderistaId={mercaderistaId}
      tipo={tipo}
      inicio={inicio}
    />
  );
}
