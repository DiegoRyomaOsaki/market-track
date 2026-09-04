import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FormPromocion } from "@/components/comercial/form-promocion";
import {
  clustersPorCliente,
  skusActivos,
} from "@/lib/comercial/opciones-datos";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editar promoción — Market Track" };

export default async function EditarPromocionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const [{ data: promocion }, skus, clusters] = await Promise.all([
    supabase
      .from("promocion")
      .select(
        "id, sku_id, precio_promo, fecha_inicio, fecha_fin, clusters, comunicada",
      )
      .eq("id", id)
      .maybeSingle(),
    skusActivos(),
    clustersPorCliente(),
  ]);

  if (!promocion) notFound();

  return (
    <FormPromocion
      promocion={promocion}
      skus={skus}
      clustersPorCliente={clusters}
    />
  );
}
