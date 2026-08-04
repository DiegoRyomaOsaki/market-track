"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export type ResultadoAccion =
  | { ok: true; resueltaAt: string; resueltaPorNombre: string }
  | { ok: false; error: string };

const SECCION = "/supervisor/solicitudes";

// Un UPDATE que la RLS bloquea NO da error: afecta a 0 filas y devuelve éxito.
// Por eso la escritura pide `.select()` y comprueba que volvió algo.
const SIN_PERMISO = "No encontrada o sin permiso";

// `z.guid()`, no `z.uuid()`: el estricto exige bits de versión RFC 9562 que
// Postgres no impone y que los ids del propio seed no cumplen.
const resolverSchema = z.object({
  id: z.guid(),
  // Aprobar escribe `resuelta`; rechazar, `rechazada`. Los otros dos estados del
  // enum (`nueva`, `vista`) no son decisiones y no se aceptan aquí.
  decision: z.enum(["resuelta", "rechazada"]),
  // El comentario es obligatorio también al aprobar: el mercaderista tiene que
  // saber qué se decidió sobre su ruta, no solo que alguien la tocó.
  comentario: z.string().trim().min(1).max(500),
});

/**
 * Resuelve una solicitud de cambio de ruta.
 *
 * El gate de rol es necesario aunque la RLS ya acote: `sol_staff_resuelve` deja
 * escribir a todo el staff, pero una server action es un endpoint POST y no la
 * protege que el botón viva en `/supervisor`. Aquí se comprueba explícitamente
 * que quien llama es admin o supervisor — nunca el mercaderista que la pidió.
 */
export async function resolverSolicitud(
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = resolverSchema.safeParse(datos);
  if (!parsed.success) {
    return { ok: false, error: "Revisa el comentario antes de resolver" };
  }

  const supabase = await createServerSupabaseClient();

  const { data: perfil } = await supabase
    .from("profile")
    .select("id, rol, nombre")
    .maybeSingle();
  if (perfil?.rol !== "admin" && perfil?.rol !== "supervisor") {
    return { ok: false, error: SIN_PERMISO };
  }

  const resueltaAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("solicitud_cambio_ruta")
    .update({
      estado: parsed.data.decision,
      comentario_resolucion: parsed.data.comentario,
      resuelta_por: perfil.id,
      resuelta_at: resueltaAt,
    })
    .eq("id", parsed.data.id)
    .select("id");

  if (error) {
    console.error("[solicitudes] resolver", error.message.slice(0, 200));
    return { ok: false, error: "No se pudo resolver la solicitud" };
  }

  if (data.length === 0) return { ok: false, error: SIN_PERMISO };

  revalidatePath(SECCION);
  return { ok: true, resueltaAt, resueltaPorNombre: perfil.nombre };
}
