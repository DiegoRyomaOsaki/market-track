import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FormTienda } from "@/components/catalogo/form-tienda";
import { env } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editar tienda — Market Track" };

export default async function EditarTiendaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const [{ data: tienda }, { data: cadenas }] = await Promise.all([
    supabase
      .from("tienda")
      .select(
        "id, nombre, tenant_id, cadena_id, direccion, cluster, codigo_externo, radio_geocerca_m, lat, lon, activo",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("cadena")
      .select("id, nombre, tenant_id")
      .eq("activo", true)
      .order("nombre"),
  ]);

  if (!tienda) notFound();
  return (
    <FormTienda
      tienda={tienda}
      cadenas={cadenas ?? []}
      urlTiles={env.TILES_URL}
    />
  );
}
