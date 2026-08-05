import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { galeriaEvidenciaSchema } from "@market-track/shared";

import { Aviso } from "@/components/panel/tabla";
import { TiendaConEvidencia } from "@/components/portal/galeria/tienda-con-evidencia";
import { urlsFirmadas } from "@/lib/fotos-firmadas";
import { periodoDeFiltros } from "@/lib/portal/dashboard";
import { requerirModulo } from "@/lib/portal/estado-modulos";
import { leerFiltros, type ParamsBusqueda } from "@/lib/portal/filtros";
import { idsFirmables } from "@/lib/portal/galeria";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Tienda — Market Track" };

// Misma razón que en la galería: las URLs firmadas caducan en minutos y esta
// página guarda evidencia privada de un cliente.
export const dynamic = "force-dynamic";

/**
 * El detalle de una tienda: su evidencia acotada a ella, con la última visita
 * arriba y el historial debajo.
 *
 * Reusa `galeria_evidencia` filtrada por tienda en vez de tener su propia RPC: es
 * el mismo árbol, y duplicarlo pondría el trozo delicado —el desempate del par,
 * la exclusión de la selfie, la ventana en Lima— en dos funciones que nadie
 * compila juntas.
 */
export default async function DetalleTiendaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tiendaId: string }>;
  searchParams: Promise<ParamsBusqueda>;
}) {
  // La galería y el detalle son la misma sección: si el cliente la tiene
  // deshabilitada, tampoco se llega por URL desde un pin del mapa.
  await requerirModulo("galeria");

  const { tiendaId } = await params;
  // Un route param es entrada externa: sin la guarda, la basura llega a Postgres
  // y vuelve como un error de cast disfrazado de fallo de carga.
  if (!z.guid().safeParse(tiendaId).success) notFound();

  const filtros = leerFiltros(await searchParams);
  const periodo = periodoDeFiltros(filtros, new Date());

  const supabase = await createServerSupabaseClient();

  // La cabecera va aparte del árbol: si la tienda no tuvo visitas en el periodo,
  // la RPC devuelve vacío y aun así hay que saber cómo se llama para decir "sin
  // evidencia" en vez de un 404 que parecería que la tienda no existe.
  const [cabecera, evidencia] = await Promise.all([
    supabase
      .from("tienda")
      .select("id, nombre, direccion, cadena:cadena_id (nombre)")
      .eq("id", tiendaId)
      .maybeSingle(),
    supabase.rpc("galeria_evidencia", {
      p_desde: periodo.desde,
      p_hasta: periodo.hasta,
      p_tienda: tiendaId,
    }),
  ]);

  if (cabecera.error) {
    console.error("[tienda] cabecera", cabecera.error.message.slice(0, 200));
    return <Aviso>No pudimos cargar la tienda. Vuelve a intentarlo.</Aviso>;
  }
  // La RLS devuelve 0 filas si la tienda es de otro cliente: indistinguible de
  // que no exista, y así no se puede sondear el catálogo ajeno.
  if (!cabecera.data) notFound();

  if (evidencia.error) {
    console.error("[tienda] evidencia", evidencia.error.message.slice(0, 200));
    return <Aviso>No pudimos cargar la evidencia. Vuelve a intentarlo.</Aviso>;
  }

  const parsed = galeriaEvidenciaSchema.safeParse(evidencia.data);
  if (!parsed.success) {
    console.error(
      "[tienda] forma inesperada",
      parsed.error.message.slice(0, 200),
    );
    return <Aviso>La evidencia llegó con un formato que no reconocemos.</Aviso>;
  }

  const { urls, degradado } = await urlsFirmadas(
    supabase,
    idsFirmables(parsed.data),
  );
  const conEvidencia = parsed.data.tiendas[0];

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/cliente/galeria"
        className="text-[12px] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        ← Volver a la galería
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="text-[15px] font-bold">{cabecera.data.nombre}</h1>
        <p className="text-[11.5px] text-muted-foreground">
          {cabecera.data.direccion ?? "Sin dirección registrada"}
        </p>
      </header>

      {degradado ? (
        <Aviso>
          No pudimos preparar los enlaces de algunas fotos. Es un problema
          nuestro, no del trabajo en tienda: vuelve a intentarlo.
        </Aviso>
      ) : null}

      {conEvidencia ? (
        <TiendaConEvidencia
          tienda={conEvidencia}
          urls={urls}
          enlazarDetalle={false}
        />
      ) : (
        <Aviso>
          Esta tienda no tuvo visitas entre {periodo.desde} y {periodo.hasta}.
        </Aviso>
      )}
    </div>
  );
}
