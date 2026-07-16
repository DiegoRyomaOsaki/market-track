import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FormCadena } from "@/components/catalogo/form-cadena";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editar cadena — Market Track" };

export default async function EditarCadenaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  // La RLS devuelve 0 filas para lo que no toca: "no existe" y "no es tuyo" son
  // la misma respuesta, a propósito.
  const [{ data: cadena }, { data: clientes }] = await Promise.all([
    supabase
      .from("cadena")
      .select("id, nombre, tenant_id, tipo_tienda, codigo_externo, activo")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("tenant")
      .select("id, nombre")
      .eq("activo", true)
      .order("nombre"),
  ]);

  if (!cadena) notFound();
  return <FormCadena cadena={cadena} clientes={clientes ?? []} />;
}
