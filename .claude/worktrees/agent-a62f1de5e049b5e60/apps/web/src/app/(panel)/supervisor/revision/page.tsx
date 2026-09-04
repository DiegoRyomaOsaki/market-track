import type { Metadata } from "next";

import { ColaRevision } from "@/components/panel/revision/cola-revision";
import { Aviso } from "@/components/panel/tabla";
import { diaEnLima, sumarDias } from "@/lib/fecha-lima";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Revisión de reportes — Market Track",
};

// La cola se mira en vivo: nada que cachear entre peticiones.
export const dynamic = "force-dynamic";

// Un reporte que nadie revisó en un mes ya no se revisa a tiempo: se persigue. La
// ventana acota la consulta sin esconder nada, porque el rango va en la URL y se
// puede ampliar.
const DIAS_DE_VENTANA = 30;

export default async function RevisionPage({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string; desde?: string; hasta?: string }>;
}) {
  const params = await searchParams;
  const soloPendientes = params.ver !== "todas";

  // El "hoy" del negocio es el día de calendario en Lima, no el de UTC.
  const hoy = diaEnLima(new Date());
  const hasta = params.hasta ?? hoy;
  const desde = params.desde ?? sumarDias(hasta, -DIAS_DE_VENTANA);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("cola_revision", {
    p_desde: desde,
    p_hasta: hasta,
  });

  if (error) {
    console.error("[revision] carga de la cola", error.message.slice(0, 200));
    return <Aviso>No pudimos cargar la cola. Vuelve a intentarlo.</Aviso>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11.5px] text-muted-foreground">
        Visitas cerradas entre {desde} y {hasta}.
      </p>
      <ColaRevision
        visitasIniciales={data ?? []}
        soloPendientes={soloPendientes}
      />
    </div>
  );
}
