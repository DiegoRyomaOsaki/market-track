import type { Metadata } from "next";

import { Aviso } from "@/components/panel/tabla";
import { FiltrosAlertas } from "@/components/portal/alertas/filtros-alertas";
import { Paginacion } from "@/components/portal/alertas/paginacion";
import { TablaAlertas } from "@/components/portal/alertas/tabla-alertas";
import { periodoDeFiltros } from "@/lib/portal/dashboard";
import { requerirModulo } from "@/lib/portal/estado-modulos";
import {
  leerFiltros,
  leerFiltrosAlerta,
  type ParamsBusqueda,
} from "@/lib/portal/filtros";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Alertas — Market Track" };

// El estado de una alerta cambia mientras el cliente trabaja la bandeja: servir
// una versión cacheada le enseñaría como "nueva" algo que acaba de resolver.
export const dynamic = "force-dynamic";

const POR_PAGINA = 50;

export default async function AlertasPortalPage({
  searchParams,
}: {
  searchParams: Promise<ParamsBusqueda>;
}) {
  await requerirModulo("alertas");

  const params = await searchParams;
  const filtros = leerFiltros(params);
  const deAlerta = leerFiltrosAlerta(params);
  const periodo = periodoDeFiltros(filtros, new Date());

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("bandeja_alertas", {
    p_desde: periodo.desde,
    p_hasta: periodo.hasta,
    // `undefined` y no `null`: los parámetros con `default` en la función se
    // tipan como opcionales, y omitirlos deja que Postgres aplique su default.
    p_cadena: filtros.cadena ?? undefined,
    p_tienda: filtros.tienda ?? undefined,
    p_tipo: deAlerta.tipo ?? undefined,
    p_severidad: deAlerta.severidad ?? undefined,
    p_estado: deAlerta.estado ?? undefined,
    p_pagina: deAlerta.pagina,
    p_por_pagina: POR_PAGINA,
  });

  if (error) {
    console.error("[alertas] bandeja", error.message.slice(0, 200));
    return <Aviso>No pudimos cargar las alertas. Vuelve a intentarlo.</Aviso>;
  }

  const alertas = data ?? [];
  // `total` viene repetido en cada fila (una ventana sobre la misma consulta).
  // Sin filas no hay total: son cero.
  const total = Number(alertas[0]?.total ?? 0);

  const busqueda = new URLSearchParams();
  for (const [clave, valor] of Object.entries(params)) {
    const v = Array.isArray(valor) ? valor[0] : valor;
    if (v !== undefined) busqueda.set(clave, v);
  }
  const querystring = busqueda.toString() ? `?${busqueda.toString()}` : "";

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11.5px] text-muted-foreground">
        {total === 0
          ? `Sin alertas entre ${periodo.desde} y ${periodo.hasta}.`
          : `${total} alerta(s) entre ${periodo.desde} y ${periodo.hasta}.`}
      </p>

      <FiltrosAlertas valores={deAlerta} />

      {/* Pedir una página que no existe no puede dejar la pantalla en blanco:
          pasa con un enlace viejo o al estrechar los filtros. */}
      {alertas.length === 0 && total > 0 ? (
        <Aviso>
          Esta página ya no tiene alertas. Vuelve a la primera con el filtro que
          quieras.
        </Aviso>
      ) : (
        <TablaAlertas alertas={alertas} querystring={querystring} />
      )}

      <Paginacion
        pagina={deAlerta.pagina}
        porPagina={POR_PAGINA}
        total={total}
        params={busqueda}
      />
    </div>
  );
}
