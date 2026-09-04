"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { sesionDeStaff } from "@/lib/panel/sesion";

export type ResultadoAccion = { ok: true } | { ok: false; error: string };

const SECCION = "/supervisor";

// Un UPDATE que la RLS bloquea NO da error: afecta a 0 filas y devuelve éxito.
// Por eso la escritura pide `.select()` y comprueba que volvió algo.
const SIN_PERMISO = "No encontrado o sin permiso";

// `z.guid()`, no `z.uuid()`: el estricto exige bits de versión y variante RFC
// 9562, que Postgres no impone y que los ids del propio seed no cumplen. Misma
// razón que en `packages/shared/src/schemas/levantamiento.ts`.
const marcarAtendidaSchema = z.object({ id: z.guid() });

/**
 * Cierra una alerta de contingencia: `resuelta` es lo que el tablero llama
 * "atendida", y es lo que descuenta del badge de pendientes.
 *
 * `authenticated` solo tiene GRANT sobre la columna `estado` de `alerta` (el
 * resto lo escribe el motor con service_role), así que este update no puede
 * tocar nada más aunque quisiera.
 *
 * EL GATE DE ROL NO ES DECORATIVO. La política `alerta_usuario_marca_estado`
 * deja cambiar el estado a cualquiera del mismo tenant, lo que está bien para el
 * portal del cliente pero no aquí: una contingencia es el aviso al supervisor de
 * que un mercaderista se saltó un paso, y quien la genera no puede ser quien la
 * apaga. Y una server action es un endpoint POST — no la protege el hecho de que
 * el botón solo se pinte en `/supervisor`.
 */
export async function marcarContingenciaAtendida(
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = marcarAtendidaSchema.safeParse(datos);
  if (!parsed.success) {
    return { ok: false, error: "Identificador de alerta inválido" };
  }

  const sesion = await sesionDeStaff();
  if (!sesion) return { ok: false, error: SIN_PERMISO };
  const { supabase } = sesion;

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
