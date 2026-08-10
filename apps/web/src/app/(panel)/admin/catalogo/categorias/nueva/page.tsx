import type { Metadata } from "next";

import { FormCategoria } from "@/components/catalogo/form-categoria";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Nueva categoría — Market Track" };

export default async function NuevaCategoriaPage() {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("tenant")
    .select("id, nombre")
    .eq("activo", true)
    .order("nombre");

  return <FormCategoria clientes={data ?? []} />;
}
