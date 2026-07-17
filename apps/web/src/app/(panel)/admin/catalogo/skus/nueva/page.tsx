import type { Metadata } from "next";

import { FormSku } from "@/components/catalogo/form-sku";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Nuevo SKU — Market Track" };

export default async function NuevoSkuPage() {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("marca")
    .select("id, nombre, tenant_id, tenant:tenant_id(nombre)")
    .eq("activo", true)
    .order("nombre");

  const marcas = (data ?? []).map((m) => ({
    id: m.id,
    nombre: m.nombre,
    tenant_id: m.tenant_id,
    cliente: m.tenant?.nombre ?? "—",
  }));

  return <FormSku marcas={marcas} />;
}
