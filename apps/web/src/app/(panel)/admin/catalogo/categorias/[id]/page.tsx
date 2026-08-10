import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FormCategoria } from "@/components/catalogo/form-categoria";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editar categoría — Market Track" };

export default async function EditarCategoriaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const [{ data: categoria }, { data: clientes }] = await Promise.all([
    supabase
      .from("categoria")
      .select("id, nombre, tenant_id, codigo_externo, activo")
      // Sin el filtro por id, la política que deja al staff leer la tabla entera
      // devolvería todas las filas y `maybeSingle()` fallaría por multiplicidad.
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("tenant")
      .select("id, nombre")
      .eq("activo", true)
      .order("nombre"),
  ]);

  if (!categoria) notFound();

  return <FormCategoria categoria={categoria} clientes={clientes ?? []} />;
}
