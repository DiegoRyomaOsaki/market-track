"use server";

import { revalidatePath } from "next/cache";

import { moduloPortalSchema } from "@market-track/shared";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import { guardarModulosSchema } from "./schema";

export type ResultadoAccion =
  { ok: true } | { ok: false; error: string; detalles?: unknown };

const SECCION = "/admin/portal";

// Un UPDATE/INSERT que la RLS bloquea NO da error: afecta a 0 filas y devuelve
// éxito. Por eso la escritura pide `.select()` y comprueba que volvió algo.
const SIN_PERMISO = "No encontrado o sin permiso";

function fallo(
  operacion: string,
  mensaje: string,
  visible: string,
): { ok: false; error: string } {
  console.error(`[portal] ${operacion}`, mensaje.slice(0, 200));
  return { ok: false, error: visible };
}

/**
 * Persiste el estado de los módulos del portal de un cliente. Upsert de una fila
 * por módulo (clave `(tenant_id, modulo)`); solo el admin puede, lo gatea la RLS
 * `portmod_admin_escribe`. Se guardan los 5 explícitos: no hay `delete`, así que
 * volver a "habilitado" es una fila con `habilitado = true`, no borrar la fila.
 */
export async function guardarModulosPortal(
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = guardarModulosSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos inválidos",
      detalles: parsed.error.issues,
    };
  }

  // Solo se tocan los módulos PRESENTES en el payload: nada de rellenar los
  // ausentes con `true`, que reactivaría en silencio módulos que otro admin
  // había deshabilitado. La UI siempre manda los 5; un payload parcial (llamada
  // directa al server action) solo cambia lo que nombra.
  const filas = moduloPortalSchema.options.flatMap((modulo) => {
    const habilitado = parsed.data.modulos[modulo];
    return habilitado === undefined
      ? []
      : [{ tenant_id: parsed.data.tenant_id, modulo, habilitado }];
  });
  if (filas.length === 0) {
    return { ok: false, error: "No hay módulos que guardar" };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("portal_modulo_habilitado")
    .upsert(filas, { onConflict: "tenant_id,modulo" })
    .select("modulo");

  if (error)
    return fallo(
      "guardado de módulos",
      error.message,
      "No se pudo guardar la configuración",
    );
  if (!data?.length) return { ok: false, error: SIN_PERMISO };

  revalidatePath(SECCION);
  return { ok: true };
}
