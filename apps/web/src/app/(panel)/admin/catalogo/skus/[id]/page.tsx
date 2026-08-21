import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FormSku } from "@/components/catalogo/form-sku";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editar SKU — Market Track" };

export default async function EditarSkuPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: sku } = await supabase
    .from("sku")
    .select(
      "id, nombre, codigo, marca_id, categoria_id, presentacion, codigo_barras, codigo_externo, activo, tenant_id",
    )
    .eq("id", id)
    .maybeSingle();

  if (!sku) notFound();

  // Las opciones son las del cliente de ESTE SKU, no las del header: editar el
  // SKU de otro cliente con las marcas del activo mezclaría catálogos.
  const [{ data: marcasData }, { data: categorias }] = await Promise.all([
    supabase
      .from("marca")
      .select("id, nombre, tenant_id, tenant:tenant_id(nombre)")
      .eq("tenant_id", sku.tenant_id)
      .eq("activo", true)
      .order("nombre"),
    supabase
      .from("categoria")
      .select("id, nombre, tenant_id")
      .eq("tenant_id", sku.tenant_id)
      .eq("activo", true)
      .order("nombre"),
  ]);

  const marcas = (marcasData ?? []).map((m) => ({
    id: m.id,
    nombre: m.nombre,
    tenant_id: m.tenant_id,
    cliente: m.tenant?.nombre ?? "—",
  }));

  return <FormSku sku={sku} marcas={marcas} categorias={categorias ?? []} />;
}
