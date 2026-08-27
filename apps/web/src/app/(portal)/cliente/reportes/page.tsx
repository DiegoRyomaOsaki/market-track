import type { Metadata } from "next";

import { Aviso } from "@/components/panel/tabla";
import { BotonImprimir } from "@/components/portal/reportes/boton-imprimir";
import { Configurador } from "@/components/portal/reportes/configurador";
import { VistaPrevia } from "@/components/portal/reportes/vista-previa";
import { diaEnLima } from "@/lib/fecha-lima";
import { periodoDeFiltros } from "@/lib/portal/dashboard";
import { requerirModulo } from "@/lib/portal/estado-modulos";
import { leerFiltros, type ParamsBusqueda } from "@/lib/portal/filtros";
import {
  armarReporte,
  leerKpis,
  serializarReporte,
} from "@/lib/portal/reportes";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Reportes — Market Track" };

/** El SDK no trae plazo propio y su default de red pasa de los 30 s. */
const PLAZO_MS = 10_000;

export default async function ReportesPortalPage({
  searchParams,
}: {
  searchParams: Promise<ParamsBusqueda>;
}) {
  await requerirModulo("reportes");

  const params = await searchParams;
  const filtros = leerFiltros(params);
  const periodo = periodoDeFiltros(filtros, new Date());
  const seleccion = leerKpis(params);

  const supabase = await createServerSupabaseClient();

  // El nombre del cliente va en la cabecera del reporte: un PDF que no dice de
  // quién es no sirve para compartirlo. Lo resuelve la RLS, que solo deja leer
  // el perfil propio y su tenant.
  const [perfilRes, kpisRes] = await Promise.all([
    supabase
      .from("profile")
      .select("cliente:tenant_id(nombre)")
      .abortSignal(AbortSignal.timeout(PLAZO_MS))
      .maybeSingle(),
    supabase
      .rpc("dashboard_kpis", {
        p_desde: periodo.desde,
        p_hasta: periodo.hasta,
        p_cadena: filtros.cadena ?? undefined,
        p_tienda: filtros.tienda ?? undefined,
      })
      .abortSignal(AbortSignal.timeout(PLAZO_MS)),
  ]);

  const cliente = perfilRes.data?.cliente?.nombre ?? "tu marca";
  const reporte = armarReporte(kpisRes.data?.[0] ?? null, seleccion, periodo);

  // Un fallo de la consulta NO se calla: sin este aviso, el reporte se pinta
  // vacío y eso se lee como "no hubo trabajo en el periodo", que es justo la
  // conclusión contraria.
  const enlaceExcel = `/cliente/reportes/excel${serializarReporte(filtros, seleccion)}`;
  const sinIndicadores = seleccion !== null && seleccion.length === 0;

  return (
    <div className="flex flex-col gap-5 px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-[19px] font-extrabold tracking-tight">Reportes</h1>
        <div className="flex items-center gap-2">
          {sinIndicadores ? (
            <span className="rounded-lg border border-border px-4 py-2 text-[13px] font-semibold text-muted-foreground">
              Descargar Excel
            </span>
          ) : (
            <a
              href={enlaceExcel}
              download
              className="rounded-lg border border-border px-4 py-2 text-[13px] font-semibold"
            >
              Descargar Excel
            </a>
          )}
          <BotonImprimir />
        </div>
      </div>

      <Configurador filtros={filtros} seleccion={seleccion} />

      {kpisRes.error ? (
        <Aviso esError>
          No se pudieron leer los indicadores. Vuelve a intentarlo en un
          momento.
        </Aviso>
      ) : sinIndicadores ? (
        <Aviso>Elige al menos un indicador para armar el reporte.</Aviso>
      ) : (
        <VistaPrevia
          reporte={reporte}
          filtros={filtros}
          cliente={cliente}
          generadoEl={diaEnLima(new Date())}
        />
      )}
    </div>
  );
}
