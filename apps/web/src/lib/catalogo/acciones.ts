"use server";

import { revalidatePath } from "next/cache";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  aFilaTienda,
  altaCadenaSchema,
  altaSkuSchema,
  altaTiendaSchema,
  codificadoSchema,
} from "./schema";

export type ResultadoAccion =
  { ok: true } | { ok: false; error: string; detalles?: unknown };

const SECCION = "/admin/catalogo";

// Una escritura que la RLS bloquea afecta a 0 filas SIN dar error: por eso toda
// escritura pide `.select()` y comprueba que volvió algo.
const SIN_PERMISO = "No encontrado o sin permiso";

function fallo(operacion: string, mensaje: string, visible: string) {
  console.error(`[catalogo] ${operacion}`, mensaje.slice(0, 200));
  return { ok: false as const, error: visible };
}

/** Traduce los errores de Postgres que son del usuario, no del sistema. */
function mensajeDe(codigo: string | undefined, entidad: string): string {
  if (codigo === "23505")
    return "Ese código externo ya existe para este cliente";
  // La FK de tienda es COMPUESTA (cadena_id, tenant_id): la base impide colgar
  // una tienda de la cadena de otro cliente, aunque la UI lo intente.
  if (codigo === "23503") return "Esa cadena no es de este cliente";
  return `No se pudo guardar ${entidad}`;
}

/**
 * El único UNIQUE del SKU es (tenant_id, codigo_externo) — el `codigo` NO es
 * único en la base. La FK a marca es compuesta (marca_id, tenant_id): impide
 * colgar un SKU de la marca de otro cliente.
 */
function mensajeDeSku(codigo: string | undefined): string {
  if (codigo === "23505")
    return "Ese código externo ya existe para este cliente";
  if (codigo === "23503") return "Esa marca no es de este cliente";
  return "No se pudo guardar el SKU";
}

export async function crearCadena(datos: unknown): Promise<ResultadoAccion> {
  const parsed = altaCadenaSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos inválidos",
      detalles: parsed.error.issues,
    };
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("cadena")
    .insert(parsed.data)
    .select("id");

  if (error)
    return fallo(
      "alta de cadena",
      error.message,
      mensajeDe(error.code, "la cadena"),
    );
  if (!data?.length) return { ok: false, error: SIN_PERMISO };
  revalidatePath(SECCION);
  return { ok: true };
}

export async function editarCadena(
  id: string,
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = altaCadenaSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos inválidos",
      detalles: parsed.error.issues,
    };
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("cadena")
    .update(parsed.data)
    .eq("id", id)
    .select("id");

  if (error)
    return fallo(
      "edición de cadena",
      error.message,
      mensajeDe(error.code, "la cadena"),
    );
  if (!data?.length) return { ok: false, error: SIN_PERMISO };
  revalidatePath(SECCION);
  return { ok: true };
}

export async function crearTienda(datos: unknown): Promise<ResultadoAccion> {
  const parsed = altaTiendaSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos inválidos",
      detalles: parsed.error.issues,
    };
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tienda")
    .insert(aFilaTienda(parsed.data))
    .select("id");

  if (error)
    return fallo(
      "alta de tienda",
      error.message,
      mensajeDe(error.code, "la tienda"),
    );
  if (!data?.length) return { ok: false, error: SIN_PERMISO };
  revalidatePath(SECCION);
  return { ok: true };
}

export async function editarTienda(
  id: string,
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = altaTiendaSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos inválidos",
      detalles: parsed.error.issues,
    };
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tienda")
    .update(aFilaTienda(parsed.data))
    .eq("id", id)
    .select("id");

  if (error)
    return fallo(
      "edición de tienda",
      error.message,
      mensajeDe(error.code, "la tienda"),
    );
  if (!data?.length) return { ok: false, error: SIN_PERMISO };
  revalidatePath(SECCION);
  return { ok: true };
}

export async function crearSku(datos: unknown): Promise<ResultadoAccion> {
  const parsed = altaSkuSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos inválidos",
      detalles: parsed.error.issues,
    };
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("sku")
    .insert(parsed.data)
    .select("id");

  if (error)
    return fallo("alta de sku", error.message, mensajeDeSku(error.code));
  if (!data?.length) return { ok: false, error: SIN_PERMISO };
  revalidatePath(SECCION);
  return { ok: true };
}

export async function editarSku(
  id: string,
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = altaSkuSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos inválidos",
      detalles: parsed.error.issues,
    };
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("sku")
    .update(parsed.data)
    .eq("id", id)
    .select("id");

  if (error)
    return fallo("edición de sku", error.message, mensajeDeSku(error.code));
  if (!data?.length) return { ok: false, error: SIN_PERMISO };
  revalidatePath(SECCION);
  return { ok: true };
}

/**
 * Codifica o descodifica un SKU en una tienda (una celda de la matriz).
 *
 * `upsert`: la fila `tienda_sku` puede no existir aún (nunca se tocó ese par) o
 * existir con otro `activo`. Descodificar apaga `activo`, no borra la fila —
 * consistente con el resto del esquema, que nunca hace DELETE de estado.
 *
 * El `tenant_id` se re-deriva de la tienda, no se toma del cliente: la política
 * de escritura de `tienda_sku` solo exige rol admin (staff, sin tenant), así que
 * el aislamiento lo sostiene la FK compuesta. Se lee la tienda por su id — la
 * RLS ya la acota al tenant del usuario, y un admin las ve todas.
 */
export async function fijarCodificado(
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = codificadoSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos inválidos",
      detalles: parsed.error.issues,
    };
  }
  const supabase = await createServerSupabaseClient();

  const { data: tienda, error: errTienda } = await supabase
    .from("tienda")
    .select("tenant_id")
    .eq("id", parsed.data.tienda_id)
    .maybeSingle();
  if (errTienda)
    return fallo(
      "codificado",
      errTienda.message,
      "No se pudo guardar el codificado",
    );
  if (!tienda) return { ok: false, error: SIN_PERMISO };

  const { data, error } = await supabase
    .from("tienda_sku")
    .upsert(
      { ...parsed.data, tenant_id: tienda.tenant_id },
      { onConflict: "tienda_id,sku_id" },
    )
    .select("tienda_id");

  if (error)
    return fallo(
      "codificado",
      error.message,
      "No se pudo guardar el codificado",
    );
  if (!data?.length) return { ok: false, error: SIN_PERMISO };
  revalidatePath(SECCION);
  return { ok: true };
}
