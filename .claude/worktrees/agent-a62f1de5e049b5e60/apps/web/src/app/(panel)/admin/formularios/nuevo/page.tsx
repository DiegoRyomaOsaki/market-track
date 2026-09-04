import type { Metadata } from "next";

import { FormFormulario } from "@/components/formularios/form-formulario";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Nuevo formulario — Market Track" };

export default async function NuevoFormularioPage() {
  const supabase = await createServerSupabaseClient();
  const [{ data: clientes }, { data: marcas }] = await Promise.all([
    supabase
      .from("tenant")
      .select("id, nombre")
      .eq("activo", true)
      .order("nombre"),
    supabase
      .from("marca")
      .select("id, nombre, tenant_id")
      .eq("activo", true)
      .order("nombre"),
  ]);

  return <FormFormulario clientes={clientes ?? []} marcas={marcas ?? []} />;
}
