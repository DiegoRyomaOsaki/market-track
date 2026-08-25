import type { Metadata } from "next";

import { Planeacion } from "@/components/panel/ruteros/planeacion";
import { Aviso } from "@/components/panel/tabla";
import { diaEnLima } from "@/lib/fecha-lima";
import { agruparPorDia, rangoDeVista, type Vista } from "@/lib/panel/ruteros";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Ruteros — Market Track" };

// La planeación cambia mientras se edita: nada que cachear entre peticiones.
export const dynamic = "force-dynamic";

type Params = { vista?: string; dia?: string; mercaderista?: string };

export default async function RuterosPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const vista: Vista = params.vista === "mes" ? "mes" : "semana";
  // El día de referencia sale de la URL; sin él, hoy en Lima. Un `dia` con
  // formato raro caería en un rango vacío, así que se valida la forma.
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(params.dia ?? "")
    ? (params.dia as string)
    : diaEnLima(new Date());
  const { desde, hasta } = rangoDeVista(vista, dia);

  const supabase = await createServerSupabaseClient();

  const [mercaderistasRes, tiendasRes] = await Promise.all([
    supabase
      .from("profile")
      .select("id, nombre")
      .eq("rol", "mercaderista")
      .eq("activo", true)
      .order("nombre"),
    supabase
      .from("tienda")
      .select("id, nombre")
      .eq("activo", true)
      .order("nombre"),
  ]);

  const fallo = mercaderistasRes.error ?? tiendasRes.error;
  if (fallo) {
    console.error("[ruteros] carga", fallo.message.slice(0, 200));
    return <Aviso>No pudimos cargar la planeación. Vuelve a intentarlo.</Aviso>;
  }

  const mercaderistas = mercaderistasRes.data ?? [];
  // Sin mercaderista en la URL, el primero de la lista: una pantalla de
  // planeación vacía no le dice nada a nadie.
  const mercaderistaId = params.mercaderista ?? mercaderistas[0]?.id ?? null;

  const planeacion = mercaderistaId
    ? await supabase.rpc("planeacion_ruteros", {
        p_mercaderista: mercaderistaId,
        p_desde: desde,
        p_hasta: hasta,
      })
    : null;

  if (planeacion?.error) {
    console.error(
      "[ruteros] planeación",
      planeacion.error.message.slice(0, 200),
    );
    return <Aviso>No pudimos cargar la planeación. Vuelve a intentarlo.</Aviso>;
  }

  return (
    <Planeacion
      vista={vista}
      dia={dia}
      mercaderistaId={mercaderistaId}
      mercaderistas={mercaderistas}
      tiendas={tiendasRes.data ?? []}
      dias={agruparPorDia(planeacion?.data ?? [], desde, hasta)}
      hoyLima={diaEnLima(new Date())}
    />
  );
}
