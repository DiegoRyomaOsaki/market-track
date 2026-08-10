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
  const [{ data: sku }, { data: marcasData }, { data: categorias }] =
    await Promise.all([
      supabase
        .from("sku")
        .select(
          "id, nombre, codigo, marca_id, categoria_id, presentacion, codigo_barras, codigo_externo, activo",
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("marca")
        .select("id, nombre, tenant_id, tenant:tenant_id(nombre)")
        .eq("activo", true)
        .order("nombre"),
      supabase
        .from("categoria")
        .select("id, nombre, tenant_id")
        .eq("activo", true)
        .order("nombre"),
    ]);

  if (!sku) notFound();
  const marcas = (marcasData ?? []).map((m) => ({
    id: m.id,
    nombre: m.nombre,
    tenant_id: m.tenant_id,
    cliente: m.tenant?.nombre ?? "—",
  }));

  return <FormSku sku={sku} marcas={marcas} categorias={categorias ?? []} />;
}
