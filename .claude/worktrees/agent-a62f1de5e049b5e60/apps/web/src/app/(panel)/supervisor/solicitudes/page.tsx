import type { Metadata } from "next";

import { BandejaSolicitudes } from "@/components/panel/solicitudes/bandeja-solicitudes";
import { Aviso } from "@/components/panel/tabla";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Solicitudes de cambio de ruta — Market Track",
};

// La bandeja se mira en vivo: nada que cachear entre peticiones.
export const dynamic = "force-dynamic";

export default async function SolicitudesPage({
  searchParams,
}: {
  searchParams: Promise<{ equipo?: string }>;
}) {
  // Por defecto, lo del propio equipo; `?equipo=todas` abre el resto. El filtro
  // es comodidad: la RLS ya deja al staff verlas todas, así que esto no es una
  // frontera de seguridad y no debe leerse como tal.
  const soloMiEquipo = (await searchParams).equipo !== "todas";

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("bandeja_solicitudes", {
    p_solo_mi_equipo: soloMiEquipo,
  });

  if (error) {
    console.error("[solicitudes] carga", error.message.slice(0, 200));
    return (
      <Aviso>No pudimos cargar las solicitudes. Vuelve a intentarlo.</Aviso>
    );
  }

  return (
    <BandejaSolicitudes
      solicitudesIniciales={data ?? []}
      soloMiEquipo={soloMiEquipo}
    />
  );
}
