import type {
  OpcionCadena,
  OpcionMarca,
} from "@/components/comercial/opciones";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Las lecturas de catálogo que alimentan los formularios comerciales.
//
// Viven aquí y no en cada página porque las páginas de alta y edición
// necesitan las mismas listas: repetir el `select` en cada una es donde se cuela
// un `eq('activo', true)` que falta y la pantalla ofrece un SKU dado de baja.
//
// Solo lo ACTIVO: negociar un espacio para un SKU descontinuado es un error de
// datos que nadie detecta hasta que el mercaderista lo busca en góndola.
//
// Y solo lo del CLIENTE que se pide: sin el `tenant_id`, cada formulario
// precarga el catálogo de TODOS los clientes para ofrecer el de uno. Los
// catálogos grandes (SKU, tienda) ya ni se precargan: van por el buscador
// server-side de `buscar-opciones.ts`.

export async function cadenasActivas(
  tenantId: string,
): Promise<OpcionCadena[]> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("cadena")
    .select("id, nombre, tenant_id")
    .eq("tenant_id", tenantId)
    .eq("activo", true)
    .order("nombre");

  return data ?? [];
}

export async function marcasActivas(tenantId: string): Promise<OpcionMarca[]> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("marca")
    .select("id, nombre, tenant_id")
    .eq("tenant_id", tenantId)
    .eq("activo", true)
    .order("nombre");

  return data ?? [];
}

/**
 * Los clusters que existen de verdad en las tiendas de UN cliente.
 *
 * `tienda.cluster` es texto libre y el catálogo de clusters es otro ticket. Hasta
 * entonces, ofrecer los valores que ya están en uso es lo que evita que una
 * promoción se acote a un cluster con una errata — que no acotaría ninguna
 * tienda y saldría en todas sin que nadie lo note.
 *
 * El distinct se hace aquí y no en SQL porque PostgREST no lo expresa sin una
 * vista, y una vista para un puñado de etiquetas sería sobre-ingeniería.
 */
export async function clustersDe(tenantId: string): Promise<string[]> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("tienda")
    .select("cluster")
    .eq("tenant_id", tenantId)
    .eq("activo", true)
    .not("cluster", "is", null);

  const distintos = new Set<string>();
  for (const t of data ?? []) {
    if (t.cluster === null || t.cluster === "") continue;
    distintos.add(t.cluster);
  }
  return [...distintos].sort();
}
