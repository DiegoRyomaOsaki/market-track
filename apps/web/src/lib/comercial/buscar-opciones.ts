"use server";

import { z } from "zod";

import type { OpcionBusqueda } from "@/components/panel/buscador-opcion";
import { escaparPatronIlike } from "@/lib/panel/listado";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// La búsqueda server-side que alimenta los buscadores de catálogo.
//
// Vive en su propio archivo y no en `opciones-datos.ts` a propósito: un módulo
// `"use server"` convierte TODOS sus exports en endpoints POST alcanzables, y
// las lecturas de opciones no tienen por qué serlo.
//
// Quien autoriza es la RLS: estas consultas devuelven lo que las políticas del
// que llama dejan ver, ni más ni menos. Lo que sí se valida aquí es la FORMA de
// la entrada — es un endpoint público para cualquier sesión.

const TOPE_OPCIONES = 20;

const consultaSchema = z.object({
  q: z.string().trim().min(1).max(80),
  // `null` = sin acotar por cliente (el selector de tienda del catálogo, que es
  // cross-tenant a propósito). Los formularios comerciales SIEMPRE lo mandan.
  tenantId: z.guid().nullable(),
});

export type ResultadoBusqueda =
  { ok: true; opciones: OpcionBusqueda[] } | { ok: false; error: string };

const NO_SE_PUDO = "No se pudo buscar. Reintenta.";

export async function buscarSkus(
  q: string,
  tenantId: string | null,
): Promise<ResultadoBusqueda> {
  const entrada = consultaSchema.safeParse({ q, tenantId });
  if (!entrada.success) return { ok: true, opciones: [] };

  const supabase = await createServerSupabaseClient();
  const patron = `%${escaparPatronIlike(entrada.data.q)}%`;
  let query = supabase
    .from("sku")
    .select("id, codigo, nombre, tenant_id")
    .eq("activo", true);
  if (entrada.data.tenantId !== null) {
    query = query.eq("tenant_id", entrada.data.tenantId);
  }

  const { data, error } = await query
    .or(`codigo.ilike.${patron},nombre.ilike.${patron}`)
    .order("codigo")
    .limit(TOPE_OPCIONES);
  if (error) {
    console.error("[panel] buscarSkus", error.message.slice(0, 200));
    return { ok: false, error: NO_SE_PUDO };
  }

  return {
    ok: true,
    opciones: (data ?? []).map((s) => ({
      id: s.id,
      etiqueta: `${s.codigo} · ${s.nombre}`,
      tenant_id: s.tenant_id,
    })),
  };
}

export async function buscarTiendas(
  q: string,
  tenantId: string | null,
): Promise<ResultadoBusqueda> {
  const entrada = consultaSchema.safeParse({ q, tenantId });
  if (!entrada.success) return { ok: true, opciones: [] };

  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from("tienda")
    .select(
      "id, nombre, tenant_id, cadena:tienda_cadena_fk(nombre), tenant:tenant_id(nombre)",
    )
    .eq("activo", true);
  if (entrada.data.tenantId !== null) {
    query = query.eq("tenant_id", entrada.data.tenantId);
  }

  const { data, error } = await query
    .ilike("nombre", `%${escaparPatronIlike(entrada.data.q)}%`)
    .order("nombre")
    .limit(TOPE_OPCIONES);
  if (error) {
    console.error("[panel] buscarTiendas", error.message.slice(0, 200));
    return { ok: false, error: NO_SE_PUDO };
  }

  return {
    ok: true,
    opciones: (data ?? []).map((t) => ({
      id: t.id,
      etiqueta:
        (t.cadena?.nombre ? `${t.cadena.nombre} · ` : "") +
        t.nombre +
        // Sin acotar por cliente, el nombre solo no ubica la tienda.
        (entrada.data.tenantId === null && t.tenant?.nombre
          ? ` (${t.tenant.nombre})`
          : ""),
      tenant_id: t.tenant_id,
    })),
  };
}
