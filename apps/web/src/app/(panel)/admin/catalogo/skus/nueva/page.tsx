import type { Metadata } from "next";

import { FormSku } from "@/components/catalogo/form-sku";
import { Aviso } from "@/components/panel/tabla";
import { tenantActivo } from "@/lib/panel/tenant-activo";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Nuevo SKU — Market Track" };

export default async function NuevoSkuPage() {
  // Las marcas y categorías que se ofrecen son las del cliente activo del
  // header: precargar las de TODOS los clientes servía miles de opciones para
  // usar un puñado.
  const tenant = await tenantActivo();
  if (!tenant) {
    return <Aviso>No hay ningún cliente activo para dar de alta SKUs.</Aviso>;
  }

  const supabase = await createServerSupabaseClient();
  const [{ data }, { data: categorias }] = await Promise.all([
    supabase
      .from("marca")
      .select("id, nombre, tenant_id, tenant:tenant_id(nombre)")
      .eq("tenant_id", tenant.id)
      .eq("activo", true)
      .order("nombre"),
    supabase
      .from("categoria")
      .select("id, nombre, tenant_id")
      .eq("tenant_id", tenant.id)
      .eq("activo", true)
      .order("nombre"),
  ]);

  const marcas = (data ?? []).map((m) => ({
    id: m.id,
    nombre: m.nombre,
    tenant_id: m.tenant_id,
    cliente: m.tenant?.nombre ?? "—",
  }));

  return <FormSku marcas={marcas} categorias={categorias ?? []} />;
}
