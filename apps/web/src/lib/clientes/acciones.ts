"use server";

import { revalidatePath } from "next/cache";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import { altaClienteSchema, altaMarcaSchema } from "./schema";

export type ResultadoAccion =
  { ok: true } | { ok: false; error: string; detalles?: unknown };

const SECCION = "/admin";

// Un UPDATE/INSERT que la RLS bloquea NO da error: afecta a 0 filas y devuelve
// éxito. Por eso toda escritura pide `.select()` y comprueba que volvió algo.
const SIN_PERMISO = "No encontrado o sin permiso";

function fallo(
  operacion: string,
  mensaje: string,
  visible: string,
): {
  ok: false;
  error: string;
} {
  // El mensaje del driver puede arrastrar contenido de la respuesta: se recorta
  // para el log y NUNCA se devuelve al navegador tal cual.
  console.error(`[clientes] ${operacion}`, mensaje.slice(0, 200));
  return { ok: false, error: visible };
}

export async function crearCliente(datos: unknown): Promise<ResultadoAccion> {
  const parsed = altaClienteSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos inválidos",
      detalles: parsed.error.issues,
    };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tenant")
    .insert(parsed.data)
    .select("id");

  if (error)
    return fallo(
      "alta de cliente",
      error.message,
      "No se pudo crear el cliente",
    );
  if (!data?.length) return { ok: false, error: SIN_PERMISO };

  revalidatePath(SECCION);
  return { ok: true };
}

export async function editarCliente(
  id: string,
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = altaClienteSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos inválidos",
      detalles: parsed.error.issues,
    };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tenant")
    .update(parsed.data)
    .eq("id", id)
    .select("id");

  if (error)
    return fallo(
      "edición de cliente",
      error.message,
      "No se pudo guardar el cliente",
    );
  if (!data?.length) return { ok: false, error: SIN_PERMISO };

  revalidatePath(SECCION);
  return { ok: true };
}

export async function crearMarca(datos: unknown): Promise<ResultadoAccion> {
  const parsed = altaMarcaSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos inválidos",
      detalles: parsed.error.issues,
    };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("marca")
    .insert(parsed.data)
    .select("id");

  if (error)
    return fallo("alta de marca", error.message, mensajeDeMarca(error.code));
  if (!data?.length) return { ok: false, error: SIN_PERMISO };

  revalidatePath(SECCION);
  return { ok: true };
}

export async function editarMarca(
  id: string,
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = altaMarcaSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos inválidos",
      detalles: parsed.error.issues,
    };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("marca")
    .update(parsed.data)
    .eq("id", id)
    .select("id");

  if (error)
    return fallo("edición de marca", error.message, mensajeDeMarca(error.code));
  if (!data?.length) return { ok: false, error: SIN_PERMISO };

  revalidatePath(SECCION);
  return { ok: true };
}

/**
 * Baja de un cliente: apaga `tenant.activo`. El acceso de sus mercaderistas es
 * DERIVADO (`app.perfil_efectivo()`), así que se revoca solo — no se toca
 * `profile.activo`, para que al reactivar el cliente no vuelva el desvinculado
 * individualmente. La RLS solo deja hacerlo a un admin.
 */
export async function desactivarCliente(
  tenantId: string,
): Promise<ResultadoAccion> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tenant")
    .update({ activo: false })
    .eq("id", tenantId)
    .select("id");

  if (error)
    return fallo(
      "baja de cliente",
      error.message,
      "No se pudo dar de baja al cliente",
    );
  if (!data?.length)
    return { ok: false, error: "Cliente no encontrado o sin permiso" };

  // La baja cambia quién aparece en Usuarios (acceso derivado), no solo aquí.
  revalidatePath(SECCION);
  revalidatePath("/admin/usuarios");
  return { ok: true };
}

/** El choque contra el UNIQUE (tenant_id, codigo_externo) es del usuario, no del sistema. */
function mensajeDeMarca(codigo: string | undefined): string {
  return codigo === "23505"
    ? "Ese código externo ya existe para este cliente"
    : "No se pudo guardar la marca";
}
