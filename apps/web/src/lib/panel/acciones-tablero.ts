"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export type ResultadoAccion = { ok: true } | { ok: false; error: string };

const SECCION = "/supervisor";

// Un UPDATE que la RLS bloquea NO da error: afecta a 0 filas y devuelve éxito.
// Por eso la escritura pide `.select()` y comprueba que volvió algo.
const SIN_PERMISO = "No encontrado o sin permiso";

const marcarAtendidaSchema = z.object({ id: z.uuid() });

/**
 * Cierra una alerta de contingencia: `resuelta` es lo que el tablero llama
 * "atendida", y es lo que descuenta del badge de pendientes.
 *
 * `authenticated` solo tiene GRANT sobre la columna `estado` de `alerta` (el
 * resto lo escribe el motor con service_role), así que este update no puede
 * tocar nada más aunque quisiera.
 */
export async function marcarContingenciaAtendida(
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = marcarAtendidaSchema.safeParse(datos);
  if (!parsed.success) {
    return { ok: false, error: "Identificador de alerta inválido" };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("alerta")
    .update({ estado: "resuelta" })
    .eq("id", parsed.data.id)
    .eq("tipo", "contingencia")
    .select("id");

  if (error) {
    console.error(
      "[tablero] marcarContingenciaAtendida",
      error.message.slice(0, 200),
    );
    return { ok: false, error: "No se pudo marcar la contingencia" };
  }

  if (data.length === 0) return { ok: false, error: SIN_PERMISO };

  revalidatePath(SECCION);
  return { ok: true };
}
