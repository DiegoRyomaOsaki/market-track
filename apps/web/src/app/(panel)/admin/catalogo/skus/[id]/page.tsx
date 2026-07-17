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
  const [{ data: sku }, { data: marcasData }] = await Promise.all([
    supabase
      .from("sku")
      .select(
        "id, nombre, codigo, marca_id, presentacion, codigo_barras, codigo_externo, activo",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("marca")
      .select("id, nombre, tenant_id, tenant:tenant_id(nombre)")
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

  return <FormSku sku={sku} marcas={marcas} />;
}
