import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FormExhibicion } from "@/components/comercial/form-exhibicion";
import { marcasActivas } from "@/lib/comercial/opciones-datos";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editar exhibición — Market Track" };

export default async function EditarExhibicionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: exhibicion } = await supabase
    .from("exhibicion_negociada")
    .select(
      "id, tienda_id, marca_id, tipo, sku_ids, cantidad_sugerida, fecha_inicio, fecha_fin, tenant_id, tienda:exh_neg_tienda_fk(nombre, activo, cadena:tienda_cadena_fk(nombre))",
    )
    .eq("id", id)
    .maybeSingle();

  if (!exhibicion) notFound();

  // El catálogo es el del cliente de ESTA exhibición, no el del header. La
  // tienda y los SKUs guardados se resuelven por id, no por búsqueda: uno
  // desactivado no aparece en los resultados y el campo se vería vacío.
  const [marcas, { data: skusGuardados }] = await Promise.all([
    marcasActivas(exhibicion.tenant_id),
    exhibicion.sku_ids.length === 0
      ? Promise.resolve({ data: [] })
      : supabase
          .from("sku")
          .select("id, codigo, nombre, activo")
          .in("id", exhibicion.sku_ids),
  ]);

  const tiendaInicial = exhibicion.tienda
    ? {
        id: exhibicion.tienda_id,
        etiqueta:
          (exhibicion.tienda.cadena?.nombre
            ? `${exhibicion.tienda.cadena.nombre} · `
            : "") +
          exhibicion.tienda.nombre +
          (exhibicion.tienda.activo ? "" : " (inactiva)"),
        tenant_id: exhibicion.tenant_id,
      }
    : null;

  const skusIniciales = (skusGuardados ?? []).map((s) => ({
    id: s.id,
    etiqueta: `${s.codigo} · ${s.nombre}` + (s.activo ? "" : " (inactivo)"),
    tenant_id: exhibicion.tenant_id,
  }));

  return (
    <FormExhibicion
      exhibicion={exhibicion}
      tenantId={exhibicion.tenant_id}
      tiendaInicial={tiendaInicial}
      marcas={marcas}
      skusIniciales={skusIniciales}
    />
  );
}
