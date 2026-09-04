import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FormPrecio } from "@/components/comercial/form-precio";
import { cadenasActivas, skusActivos } from "@/lib/comercial/opciones-datos";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editar precio — Market Track" };

export default async function EditarPrecioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const [{ data: precio }, skus, cadenas] = await Promise.all([
    supabase
      .from("precio_regular")
      .select("id, sku_id, cadena_id, tipo_tienda, precio, vigente_desde")
      // Sin el filtro por id, la política que deja al staff leer la tabla entera
      // devolvería todas las filas y `maybeSingle()` fallaría por multiplicidad.
      .eq("id", id)
      .maybeSingle(),
    skusActivos(),
    cadenasActivas(),
  ]);

  if (!precio) notFound();

  return <FormPrecio precio={precio} skus={skus} cadenas={cadenas} />;
}
