import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FormMarca } from "@/components/clientes/form-marca";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editar marca — Market Track" };

export default async function EditarMarcaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const [{ data: marca, error }, { data: clientes }] = await Promise.all([
    supabase
      .from("marca")
      .select(
        "id, nombre, tenant_id, tolerancia_precio_pct, codigo_externo, activo",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("tenant")
      .select("id, nombre")
      .eq("activo", true)
      .order("nombre"),
  ]);

  if (error || !marca) notFound();
  return <FormMarca marca={marca} clientes={clientes ?? []} />;
}
