import type { Metadata } from "next";

import { Aviso } from "@/components/panel/tabla";
import { TableroVivo } from "@/components/panel/tablero/tablero-vivo";
import { env } from "@/lib/env";
import { hoyEnLima } from "@/lib/panel/tablero";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Tablero del día — Market Track" };

// El tablero se mira en vivo: nada que cachear entre peticiones.
export const dynamic = "force-dynamic";

export default async function TableroPage() {
  const supabase = await createServerSupabaseClient();
  // El "hoy" del negocio es el día de calendario en Lima. Con la fecha de UTC, a
  // partir de las 19:00 el tablero saltaría al día siguiente y se vaciaría en
  // plena jornada de cierre de tienda.
  const fecha = hoyEnLima(new Date());

  const [visitasRes, contingenciasRes] = await Promise.all([
    supabase.rpc("tablero_dia", { p_fecha: fecha }),
    supabase.rpc("tablero_contingencias", { p_fecha: fecha }),
  ]);

  const fallo = visitasRes.error ?? contingenciasRes.error;
  if (fallo) {
    console.error("[tablero] carga", fallo.message.slice(0, 200));
    return <Aviso>No pudimos cargar el tablero. Vuelve a intentarlo.</Aviso>;
  }

  return (
    <TableroVivo
      filasIniciales={visitasRes.data ?? []}
      contingenciasIniciales={contingenciasRes.data ?? []}
      urlTiles={env.TILES_URL}
    />
  );
}
