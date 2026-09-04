import type {
  OpcionCadena,
  OpcionMarca,
  OpcionSku,
  OpcionTienda,
} from "@/components/comercial/opciones";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Las lecturas de catálogo que alimentan los formularios comerciales.
//
// Viven aquí y no en cada página porque las cinco páginas de alta y edición
// necesitan las mismas listas: repetir el `select` en cada una es donde se cuela
// un `eq('activo', true)` que falta y la pantalla ofrece un SKU dado de baja.
//
// Solo lo ACTIVO: negociar un espacio para un SKU descontinuado es un error de
// datos que nadie detecta hasta que el mercaderista lo busca en góndola.

export async function skusActivos(): Promise<OpcionSku[]> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("sku")
    .select("id, codigo, nombre, tenant_id, tenant:tenant_id(nombre)")
    .eq("activo", true)
    .order("codigo");

  return (data ?? []).map((s) => ({
    id: s.id,
    codigo: s.codigo,
    nombre: s.nombre,
    tenant_id: s.tenant_id,
    cliente: s.tenant?.nombre ?? "—",
  }));
}

export async function cadenasActivas(): Promise<OpcionCadena[]> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("cadena")
    .select("id, nombre, tenant_id")
    .eq("activo", true)
    .order("nombre");

  return data ?? [];
}

export async function tiendasActivas(): Promise<OpcionTienda[]> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("tienda")
    .select("id, nombre, tenant_id, tenant:tenant_id(nombre)")
    .eq("activo", true)
    .order("nombre");

  return (data ?? []).map((t) => ({
    id: t.id,
    nombre: t.nombre,
    tenant_id: t.tenant_id,
    cliente: t.tenant?.nombre ?? "—",
  }));
}

export async function marcasActivas(): Promise<OpcionMarca[]> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("marca")
    .select("id, nombre, tenant_id")
    .eq("activo", true)
    .order("nombre");

  return data ?? [];
}

/**
 * Los clusters que existen de verdad en las tiendas de cada cliente.
 *
 * `tienda.cluster` es texto libre y el catálogo de clusters es otro ticket. Hasta
 * entonces, ofrecer los valores que ya están en uso es lo que evita que una
 * promoción se acote a un cluster con una errata — que no acotaría ninguna
 * tienda y saldría en todas sin que nadie lo note.
 */
export async function clustersPorCliente(): Promise<Record<string, string[]>> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("tienda")
    .select("tenant_id, cluster")
    .eq("activo", true)
    .not("cluster", "is", null);

  const porCliente = new Map<string, Set<string>>();
  for (const t of data ?? []) {
    if (t.cluster === null || t.cluster === "") continue;
    const yaVistos = porCliente.get(t.tenant_id) ?? new Set<string>();
    yaVistos.add(t.cluster);
    porCliente.set(t.tenant_id, yaVistos);
  }

  return Object.fromEntries(
    [...porCliente].map(([tenantId, clusters]) => [
      tenantId,
      [...clusters].sort(),
    ]),
  );
}
