import type { Metadata } from "next";
import Link from "next/link";

import { Aviso } from "@/components/panel/tabla";
import { KpisFila } from "@/components/portal/dashboard/kpis";
import { GraficaEvolucion } from "@/components/portal/perfect-store/grafica-evolucion";
import { MigasDrilldown } from "@/components/portal/perfect-store/migas-drilldown";
import { TablaDesglose } from "@/components/portal/perfect-store/tabla-desglose";
import { periodoAnterior, periodoDeFiltros } from "@/lib/portal/dashboard";
import { modulosDelCliente, requerirModulo } from "@/lib/portal/estado-modulos";
import { leerFiltros, type ParamsBusqueda } from "@/lib/portal/filtros";
import {
  armarVariables,
  barrasDeSerie,
  ETIQUETA_NIVEL,
  hrefDelGrupo,
  leerFiltrosPerfectStore,
  migasDelDrilldown,
  nivelDelDrilldown,
} from "@/lib/portal/perfect-store";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Perfect Store — Market Track" };

export default async function PerfectStorePage({
  searchParams,
}: {
  searchParams: Promise<ParamsBusqueda>;
}) {
  await requerirModulo("perfect_store");

  const params = await searchParams;
  const globales = leerFiltros(params);
  const propios = leerFiltrosPerfectStore(params);
  const periodo = periodoDeFiltros(globales, new Date());
  const previo = periodoAnterior(periodo);

  const seleccion = {
    categoria: propios.categoria,
    tipoTienda: propios.tipoTienda,
    cadena: globales.cadena,
    tienda: globales.tienda,
  };
  const nivel = nivelDelDrilldown(seleccion);

  const corte = {
    p_categoria: propios.categoria ?? undefined,
    p_tipo_tienda: propios.tipoTienda ?? undefined,
    p_cadena: globales.cadena ?? undefined,
    p_tienda: globales.tienda ?? undefined,
  };

  const supabase = await createServerSupabaseClient();
  const [actualRes, previoRes, serieRes, desgloseRes, nombres, estado] =
    await Promise.all([
      supabase.rpc("perfect_store_agregado", {
        p_desde: periodo.desde,
        p_hasta: periodo.hasta,
        ...corte,
      }),
      supabase.rpc("perfect_store_agregado", {
        p_desde: previo.desde,
        p_hasta: previo.hasta,
        ...corte,
      }),
      supabase.rpc("perfect_store_serie", {
        p_desde: periodo.desde,
        p_hasta: periodo.hasta,
        p_granularidad: propios.granularidad,
        ...corte,
      }),
      // En la hoja del drill-down no hay nivel que desglosar: no se pide.
      nivel
        ? supabase.rpc("perfect_store_desglose", {
            p_desde: periodo.desde,
            p_hasta: periodo.hasta,
            p_nivel: nivel,
            ...corte,
          })
        : Promise.resolve(null),
      nombresDeLaSeleccion(supabase, seleccion),
      modulosDelCliente(),
    ]);

  if (actualRes.error || serieRes.error || desgloseRes?.error) {
    const detalle =
      actualRes.error?.message ??
      serieRes.error?.message ??
      desgloseRes?.error?.message ??
      "";
    console.error(
      JSON.stringify({
        evento: "perfect_store_portal_error",
        detalle: detalle.slice(0, 200),
      }),
    );
    return <Aviso>No pudimos cargar Perfect Store. Vuelve a intentarlo.</Aviso>;
  }

  // El periodo anterior NO tumba la pantalla: sin él se pierde la comparación,
  // no el puntaje. Pero se registra — un fallo repetido aquí es un fallo de la
  // capa de datos, y tragárselo lo dejaría invisible para siempre.
  if (previoRes.error) {
    console.error(
      JSON.stringify({
        evento: "perfect_store_periodo_previo_error",
        detalle: previoRes.error.message.slice(0, 200),
      }),
    );
  }

  const actual = actualRes.data?.[0] ?? null;
  // Un periodo sin levantamientos no es un puntaje de cero: no hay puntaje.
  const hayDatos = Number(actual?.levantamientos ?? 0) > 0;
  const variables = armarVariables(
    hayDatos ? actual : null,
    Number(previoRes.data?.[0]?.levantamientos ?? 0) > 0
      ? (previoRes.data?.[0] ?? null)
      : null,
  );

  const barras = barrasDeSerie(serieRes.data ?? [], propios.granularidad);
  const migas = migasDelDrilldown(seleccion, nombres, params);

  const hrefDeGranularidad = (g: string): string => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      const uno = Array.isArray(v) ? v[0] : v;
      if (uno !== undefined) next.set(k, uno);
    }
    next.set("granularidad", g);
    return `/cliente/perfect-store?${next.toString()}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <MigasDrilldown migas={migas} />

      <p className="text-[11.5px] text-muted-foreground">
        {hayDatos
          ? `${actual?.levantamientos} levantamiento(s) puntuado(s) entre ${periodo.desde} y ${periodo.hasta}.`
          : `Sin levantamientos puntuados entre ${periodo.desde} y ${periodo.hasta}.`}
      </p>

      <KpisFila kpis={variables} />

      <p className="text-[11.5px] text-muted-foreground">
        Material POP y Orden todavía no se miden en campo: su peso se reparte
        entre las variables evaluadas, no cuentan como cero.
      </p>

      <GraficaEvolucion
        barras={barras}
        granularidad={propios.granularidad}
        hrefDeGranularidad={hrefDeGranularidad}
      />

      {nivel ? (
        <TablaDesglose
          nivel={nivel}
          filas={desgloseRes?.data ?? []}
          hrefDeFila={(clave) => hrefDelGrupo(nivel, clave, params)}
        />
      ) : (
        <Aviso>
          Estás viendo una tienda concreta: no hay un nivel más detallado que
          desglosar. Sube por el rastro de arriba para comparar con otras.
          {/* El puntaje dice QUÉ variable cae; la evidencia dice por qué. Solo
              si la galería está habilitada: una sección apagada no es únicamente
              invisible, es inaccesible, y el enlace llevaría a un 404. */}
          {globales.tienda && estado.galeria ? (
            <>
              {" "}
              <Link
                href={`/cliente/tienda/${encodeURIComponent(globales.tienda)}`}
                className="inline-flex min-h-11 items-center underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Ver la evidencia fotográfica de esta tienda
              </Link>
            </>
          ) : null}
        </Aviso>
      )}

      <p className="sr-only">
        Nivel de desglose actual:{" "}
        {nivel ? ETIQUETA_NIVEL[nivel] : "tienda individual"}.
      </p>
    </div>
  );
}

type Supabase = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/**
 * Los nombres de lo que está filtrado, para el rastro del drill-down.
 *
 * Se pide SOLO lo elegido y siempre por id: una consulta de una fila sobre una
 * tabla que el staff lee entera devuelve muchas si no se filtra por el id.
 */
async function nombresDeLaSeleccion(
  supabase: Supabase,
  seleccion: {
    categoria: string | null;
    cadena: string | null;
    tienda: string | null;
  },
): Promise<{ categoria?: string; cadena?: string; tienda?: string }> {
  const [categoria, cadena, tienda] = await Promise.all([
    seleccion.categoria
      ? supabase
          .from("categoria")
          .select("nombre")
          .eq("id", seleccion.categoria)
          .maybeSingle()
      : null,
    seleccion.cadena
      ? supabase
          .from("cadena")
          .select("nombre")
          .eq("id", seleccion.cadena)
          .maybeSingle()
      : null,
    seleccion.tienda
      ? supabase
          .from("tienda")
          .select("nombre")
          .eq("id", seleccion.tienda)
          .maybeSingle()
      : null,
  ]);

  return {
    categoria: categoria?.data?.nombre ?? undefined,
    cadena: cadena?.data?.nombre ?? undefined,
    tienda: tienda?.data?.nombre ?? undefined,
  };
}
