import type { Metadata } from "next";

import { FormCadena } from "@/components/catalogo/form-cadena";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Nueva cadena — Market Track" };

export default async function NuevaCadenaPage() {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("tenant")
    .select("id, nombre")
    .eq("activo", true)
    .order("nombre");

  return <FormCadena clientes={data ?? []} />;
}
