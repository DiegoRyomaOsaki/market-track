import type { Metadata } from "next";

import { FeedAlertas } from "@/components/portal/dashboard/feed-alertas";
import { KpisFila } from "@/components/portal/dashboard/kpis";
import { MapaTiendas } from "@/components/portal/dashboard/mapa-tiendas";
import { Aviso } from "@/components/panel/tabla";
import {
  armarKpis,
  colorDePin,
  periodoPorDefecto,
} from "@/lib/portal/dashboard";
import { env } from "@/lib/env";
import { leerFiltros, type ParamsBusqueda } from "@/lib/portal/filtros";
import { modulosDelCliente, requerirModulo } from "@/lib/portal/estado-modulos";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard — Market Track" };

export default async function DashboardPortalPage({
  searchParams,
}: {
  searchParams: Promise<ParamsBusqueda>;
}) {
  await requerirModulo("dashboard");

  const filtros = leerFiltros(await searchParams);
  // El período es el filtrado o, si no hay fechas, los últimos 30 días.
  const periodo =
    filtros.desde && filtros.hasta
      ? { desde: filtros.desde, hasta: filtros.hasta }
      : periodoPorDefecto(new Date());
  const args = {
    p_desde: periodo.desde,
    p_hasta: periodo.hasta,
    p_cadena: filtros.cadena ?? undefined,
    p_tienda: filtros.tienda ?? undefined,
  };

  const supabase = await createServerSupabaseClient();
  const [estado, kpisRes, pinesRes, alertasRes] = await Promise.all([
    modulosDelCliente(),
    supabase.rpc("dashboard_kpis", args),
    supabase.rpc("dashboard_pines", args),
    supabase.rpc("dashboard_alertas", args),
  ]);

  const fila = kpisRes.data?.[0] ?? null;
  const kpis = fila ? armarKpis(fila) : [];

  const pines = (pinesRes.data ?? []).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    lat: p.lat,
    lon: p.lon,
    color: colorDePin(p.ultima_visita_estado, p.tiene_alerta, p.visitada),
  }));

  const alertas = alertasRes.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <KpisFila kpis={kpis} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {estado.mapa ? (
            env.TILES_URL ? (
              <MapaTiendas urlTiles={env.TILES_URL} pines={pines} />
            ) : (
              <Aviso>No hay mapa base configurado para este entorno.</Aviso>
            )
          ) : null}
        </div>
        <FeedAlertas alertas={alertas} />
      </div>
    </div>
  );
}
