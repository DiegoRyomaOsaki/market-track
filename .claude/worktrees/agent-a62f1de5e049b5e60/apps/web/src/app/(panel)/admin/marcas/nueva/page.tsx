import type { Metadata } from "next";

import { FormMarca } from "@/components/clientes/form-marca";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Nueva marca — Market Track" };

export default async function NuevaMarcaPage() {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("tenant")
    .select("id, nombre")
    .eq("activo", true)
    .order("nombre");

  return <FormMarca clientes={data ?? []} />;
}
