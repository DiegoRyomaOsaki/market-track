import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FormCliente } from "@/components/clientes/form-cliente";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editar cliente — Market Track" };

export default async function EditarClientePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  // `maybeSingle`: la RLS devuelve 0 filas para lo que no toca. Un cliente que no
  // existe y uno que no me corresponde son la misma respuesta, a propósito.
  const { data, error } = await supabase
    .from("tenant")
    .select("id, nombre, activo")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) notFound();
  return <FormCliente cliente={data} />;
}
