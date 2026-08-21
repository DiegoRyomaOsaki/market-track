import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FormPromocion } from "@/components/comercial/form-promocion";
import { clustersDe } from "@/lib/comercial/opciones-datos";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editar promoción — Market Track" };

export default async function EditarPromocionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: promocion } = await supabase
    .from("promocion")
    .select(
      "id, sku_id, precio_promo, fecha_inicio, fecha_fin, clusters, comunicada, tenant_id, sku:promocion_sku_fk(codigo, nombre, activo)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!promocion) notFound();

  // El catálogo es el del cliente de ESTA promoción, no el del header.
  const clusters = await clustersDe(promocion.tenant_id);

  const skuInicial = promocion.sku
    ? {
        id: promocion.sku_id,
        etiqueta:
          `${promocion.sku.codigo} · ${promocion.sku.nombre}` +
          (promocion.sku.activo ? "" : " (inactivo)"),
        tenant_id: promocion.tenant_id,
      }
    : null;

  return (
    <FormPromocion
      promocion={promocion}
      tenantId={promocion.tenant_id}
      skuInicial={skuInicial}
      clusters={clusters}
    />
  );
}
