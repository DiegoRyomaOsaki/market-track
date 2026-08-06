"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { estadoAlertaSchema } from "@market-track/shared";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export type ResultadoEstadoAlerta =
  { ok: true; estado: string } | { ok: false; error: string };

const SECCION = "/cliente/alertas";

// Un UPDATE que la RLS bloquea NO da error: afecta a 0 filas y devuelve éxito.
// Por eso la escritura pide `.select()` y comprueba que volvió algo. Sin esto, un
// cliente cuyo acceso ya se revocó —con el token todavía vivo— vería "Guardado"
// sin que se guardara nada.
const SIN_PERMISO = "No encontrada o sin permiso";

// `z.guid()`, no `z.uuid()`: el estricto exige bits de versión RFC 9562 que
// Postgres no impone y que los ids del propio seed no cumplen.
const marcarSchema = z.object({
  alertaId: z.guid(),
  estado: estadoAlertaSchema,
});

/**
 * Mueve una alerta por su ciclo de triage.
 *
 * Escribe SOLO `estado`, y no porque aquí se elija: el `grant update (estado)`
 * de la migración de endurecimiento hace que cualquier otra columna muera con un
 * permission denied. La evidencia es inmutable en la base, no por convención.
 */
export async function marcarEstadoAlerta(
  datos: unknown,
): Promise<ResultadoEstadoAlerta> {
  const parsed = marcarSchema.safeParse(datos);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos" };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("alerta")
    .update({ estado: parsed.data.estado })
    .eq("id", parsed.data.alertaId)
    .select("id, estado");

  if (error) {
    // Los mensajes de un driver de base de datos pueden arrastrar contenido de la
    // respuesta: se registran, no se devuelven.
    console.error("[alertas] marcarEstado", error.message.slice(0, 200));
    return { ok: false, error: SIN_PERMISO };
  }
  // Cero filas: la alerta no existe o la RLS la esconde. Los dos casos se
  // responden igual — distinguirlos confirmaría que la ajena existe.
  const fila = data?.[0];
  if (!fila) return { ok: false, error: SIN_PERMISO };

  console.info(
    JSON.stringify({
      evento: "alerta_estado_cambiado",
      alerta_id: parsed.data.alertaId,
      a: parsed.data.estado,
    }),
  );

  revalidatePath(SECCION);
  revalidatePath(`${SECCION}/${parsed.data.alertaId}`);
  return { ok: true, estado: fila.estado };
}
