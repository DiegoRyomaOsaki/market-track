"use server";

import { revalidatePath } from "next/cache";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import { aFilaTienda, altaCadenaSchema, altaTiendaSchema } from "./schema";

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
