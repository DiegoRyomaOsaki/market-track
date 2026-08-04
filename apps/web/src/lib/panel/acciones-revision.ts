"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { sesionDeStaff } from "@/lib/panel/sesion";

export type ResultadoRevision =
  | { ok: true; revisorNombre: string; revisadoAt: string }
  | { ok: false; error: string };

const SECCION = "/supervisor/revision";

const SIN_PERMISO = "No encontrada o sin permiso";

// `z.guid()`, no `z.uuid()`: el estricto exige bits de versión RFC 9562 que
// Postgres no impone y que los ids del propio seed no cumplen.
const revisarSchema = z
  .object({
    visitaId: z.guid(),
    decision: z.enum(["aprobada", "rechazada"]),
    // El tope espeja el CHECK de la base: cortar aquí evita un viaje a Postgres
    // para que lo rechace igual.
    motivo: z.string().max(500).optional(),
  })
  // Rechazar sin decir por qué es la mitad de un rechazo: el mercaderista lee ese
  // texto en su app y es lo único que le dice qué corregir. La base lo exige
  // también con un CHECK; esto lo para antes de la red y con mejor mensaje.
  .refine(
    (d) => d.decision !== "rechazada" || (d.motivo?.trim() ?? "") !== "",
    { path: ["motivo"], message: "Explica por qué se rechaza" },
  );

/** Aprueba o rechaza el reporte de una visita, firmado por quien llama. */
export async function revisarVisita(
  datos: unknown,
): Promise<ResultadoRevision> {
  const parsed = revisarSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos",
    };
  }

  const sesion = await sesionDeStaff();
  if (!sesion) return { ok: false, error: SIN_PERMISO };
  const { supabase, perfil } = sesion;

  const { data, error } = await supabase.rpc("revisar_visita", {
    p_visita_id: parsed.data.visitaId,
    p_decision: parsed.data.decision,
    // Cadena vacía y no `null`: la función la normaliza con `nullif(btrim(...))`,
    // así que las dos guardan lo mismo, y el tipo generado del parámetro no admite
    // nulo porque no tiene default en el SQL.
    p_motivo: parsed.data.motivo ?? "",
  });

  if (error) {
    // Los mensajes de un driver de base de datos pueden arrastrar contenido de la
    // respuesta: se registran, no se devuelven.
    console.error("[revision] revisarVisita", error.message.slice(0, 200));
    return { ok: false, error: SIN_PERMISO };
  }

  console.info(
    JSON.stringify({
      evento: "visita_revisada",
      visita_id: parsed.data.visitaId,
      decision: parsed.data.decision,
      revisor_id: perfil.id,
    }),
  );

  revalidatePath(SECCION);
  return { ok: true, revisorNombre: perfil.nombre, revisadoAt: data };
}
