"use server";

import { periodoPuntajeSchema } from "@market-track/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { sesionDeStaff } from "@/lib/panel/sesion";

// El recálculo del plan de lealtad, desde el ranking.
//
// Existe porque nadie más dispara el motor todavía: sin esto, el ranking
// nacería vacío en producción. Es una Server Action —un endpoint POST
// alcanzable— así que el rol se comprueba aquí Y la RPC vuelve a cortarlo con
// 42501; la doble verja es barata y la de la base es la que manda.

const entradaSchema = z.object({
  tipo: periodoPuntajeSchema,
  inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
});

export type ResultadoRecalculo =
  | { ok: true; procesados: number; bloqueados: number }
  | { ok: false; error: string };

export async function recalcularPeriodo(
  tipo: string,
  inicio: string,
): Promise<ResultadoRecalculo> {
  const sesion = await sesionDeStaff();
  if (!sesion) return { ok: false, error: "Sin permiso para recalcular." };

  const entrada = entradaSchema.safeParse({ tipo, inicio });
  if (!entrada.success) {
    return { ok: false, error: "Revisa el periodo antes de recalcular." };
  }

  const { data, error } = await sesion.supabase
    .rpc("recalcular_puntaje_merchandiser", {
      p_tipo: entrada.data.tipo,
      p_inicio: entrada.data.inicio,
    })
    .maybeSingle();

  if (error || !data) {
    console.error(
      "[ranking] recalcular",
      error ? error.message.slice(0, 200) : "sin resultado",
    );
    return { ok: false, error: "No se pudo recalcular. Reintenta." };
  }

  // Evento de negocio con consecuencia económica: quién recalculó qué y cuántos
  // periodos quedaron sin cerrar por el guardarraíl de fotos.
  console.info(
    `[ranking] recálculo ${entrada.data.tipo} ${entrada.data.inicio} por ${sesion.perfil.id}: ${data.procesados} procesados, ${data.bloqueados} bloqueados`,
  );

  revalidatePath("/admin/ranking");
  revalidatePath("/supervisor/ranking");
  return { ok: true, procesados: data.procesados, bloqueados: data.bloqueados };
}
