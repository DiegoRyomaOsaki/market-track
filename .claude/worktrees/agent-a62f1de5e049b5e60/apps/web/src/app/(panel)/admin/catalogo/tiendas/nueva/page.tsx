import type { Metadata } from "next";

import { FormTienda } from "@/components/catalogo/form-tienda";
import { env } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Nueva tienda — Market Track" };

export default async function NuevaTiendaPage() {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("cadena")
    .select("id, nombre, tenant_id")
    .eq("activo", true)
    .order("nombre");

  return <FormTienda cadenas={data ?? []} urlTiles={env.TILES_URL} />;
}
