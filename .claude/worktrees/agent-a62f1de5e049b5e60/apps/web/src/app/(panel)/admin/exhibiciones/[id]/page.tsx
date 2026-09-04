import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FormExhibicion } from "@/components/comercial/form-exhibicion";
import {
  marcasActivas,
  skusActivos,
  tiendasActivas,
} from "@/lib/comercial/opciones-datos";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editar exhibición — Market Track" };

export default async function EditarExhibicionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const [{ data: exhibicion }, tiendas, marcas, skus] = await Promise.all([
    supabase
      .from("exhibicion_negociada")
      .select(
        "id, tienda_id, marca_id, tipo, sku_ids, cantidad_sugerida, fecha_inicio, fecha_fin",
      )
      .eq("id", id)
      .maybeSingle(),
    tiendasActivas(),
    marcasActivas(),
    skusActivos(),
  ]);

  if (!exhibicion) notFound();

  return (
    <FormExhibicion
      exhibicion={exhibicion}
      tiendas={tiendas}
      marcas={marcas}
      skus={skus}
    />
  );
}
