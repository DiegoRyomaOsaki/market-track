import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FormPrecio } from "@/components/comercial/form-precio";
import { cadenasActivas } from "@/lib/comercial/opciones-datos";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editar precio — Market Track" };

export default async function EditarPrecioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: precio } = await supabase
    .from("precio_regular")
    .select(
      "id, sku_id, cadena_id, tipo_tienda, precio, vigente_desde, tenant_id, sku:precio_sku_fk(codigo, nombre, activo)",
    )
    // Sin el filtro por id, la política que deja al staff leer la tabla entera
    // devolvería todas las filas y `maybeSingle()` fallaría por multiplicidad.
    .eq("id", id)
    .maybeSingle();

  if (!precio) notFound();

  // El catálogo que se ofrece es el del CLIENTE DE ESTE PRECIO, no el del
  // header: editar una fila de otro cliente con las cadenas del activo
  // mezclaría catálogos y la FK compuesta rechazaría el envío.
  const cadenas = await cadenasActivas(precio.tenant_id);

  // El SKU guardado se resuelve por id, no por búsqueda: uno desactivado no
  // aparece en los resultados y el campo se vería vacío.
  const skuInicial = precio.sku
    ? {
        id: precio.sku_id,
        etiqueta:
          `${precio.sku.codigo} · ${precio.sku.nombre}` +
          (precio.sku.activo ? "" : " (inactivo)"),
        tenant_id: precio.tenant_id,
      }
    : null;

  return (
    <FormPrecio
      precio={precio}
      tenantId={precio.tenant_id}
      skuInicial={skuInicial}
      cadenas={cadenas}
    />
  );
}
