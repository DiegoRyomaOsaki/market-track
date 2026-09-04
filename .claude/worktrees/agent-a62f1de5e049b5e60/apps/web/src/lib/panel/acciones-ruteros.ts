"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { sesionDeStaff } from "@/lib/panel/sesion";

export type ResultadoAccion = { ok: true } | { ok: false; error: string };

const SECCION = "/supervisor/ruteros";

// Un UPDATE/INSERT que la RLS bloquea NO da error: afecta a 0 filas y devuelve
// éxito. Por eso las escrituras directas piden `.select()` y comprueban que
// volvió algo.
const SIN_PERMISO = "No encontrado o sin permiso";

// `z.guid()`, no `z.uuid()`: el estricto exige bits de versión RFC 9562 que
// Postgres no impone y que los ids del propio seed no cumplen.
const id = z.guid();
const fecha = z.iso.date();

function fallo(operacion: string, error: { message: string }): ResultadoAccion {
  console.error(`[ruteros] ${operacion}`, error.message.slice(0, 200));
  return { ok: false, error: "No se pudo guardar el cambio" };
}

const agregarSchema = z.object({
  mercaderistaId: id,
  fecha,
  tiendaId: id,
});

/** Asigna una tienda a un día. Crea el rutero si ese día aún no tiene. */
export async function agregarParada(datos: unknown): Promise<ResultadoAccion> {
  const parsed = agregarSchema.safeParse(datos);
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };

  const sesion = await sesionDeStaff();
  if (!sesion) return { ok: false, error: SIN_PERMISO };
  const { supabase } = sesion;

  const { error } = await supabase.rpc("agregar_parada_rutero", {
    p_mercaderista: parsed.data.mercaderistaId,
    p_fecha: parsed.data.fecha,
    p_tienda: parsed.data.tiendaId,
  });
  if (error) return fallo("agregarParada", error);

  revalidatePath(SECCION);
  return { ok: true };
}

// `HH:MM` de Lima, o cadena vacía para quitarla. El `time` de Postgres acepta
// más formatos, pero lo que manda el navegador es esto y nada más tiene por qué
// llegar: validar en la frontera es no confiar en que el cliente sea el nuestro.
const fijarHoraSchema = z.object({
  paradaId: id,
  hora: z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)]),
});

/**
 * Fija la hora esperada de una parada, o la quita con la cadena vacía.
 *
 * Es la base de la puntualidad: el desvío se mide contra esto. Por eso la escribe
 * el staff y nunca el mercaderista — si el evaluado pudiera mover la hora, la
 * puntualidad la fijaría él.
 */
export async function fijarHoraParada(
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = fijarHoraSchema.safeParse(datos);
  if (!parsed.success) return { ok: false, error: "Hora inválida" };

  const sesion = await sesionDeStaff();
  if (!sesion) return { ok: false, error: SIN_PERMISO };
  const { supabase } = sesion;

  // Sin `p_hora` la función la quita: su default es NULL. Se omite en vez de
  // mandar null porque el generador tipa todo parámetro como no-nulo.
  const { error } = await supabase.rpc(
    "fijar_hora_parada",
    parsed.data.hora === ""
      ? { p_parada: parsed.data.paradaId }
      : { p_parada: parsed.data.paradaId, p_hora: parsed.data.hora },
  );
  if (error) return fallo("fijarHoraParada", error);

  revalidatePath(SECCION);
  return { ok: true };
}

/** Quita una parada. El hueco de orden que deja lo cierra el siguiente reorden. */
export async function quitarParada(datos: unknown): Promise<ResultadoAccion> {
  const parsed = z.object({ paradaId: id }).safeParse(datos);
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };

  const sesion = await sesionDeStaff();
  if (!sesion) return { ok: false, error: SIN_PERMISO };
  const { supabase } = sesion;

  const { data, error } = await supabase
    .from("rutero_parada")
    .delete()
    .eq("id", parsed.data.paradaId)
    .select("id");
  if (error) return fallo("quitarParada", error);
  if (data.length === 0) return { ok: false, error: SIN_PERMISO };

  revalidatePath(SECCION);
  return { ok: true };
}

// Una jornada real son cinco u ocho tiendas; el tope está muy por encima de lo
// que cabe en un día de trabajo y aun así acota el payload.
const MAX_PARADAS_POR_DIA = 100;

const reordenarSchema = z.object({
  ruteroId: id,
  // La lista COMPLETA, no "sube esta una posición": dos supervisores con
  // operaciones relativas sobre el mismo rutero se pisan.
  paradas: z
    .array(id)
    .min(1)
    .max(MAX_PARADAS_POR_DIA)
    // Un id repetido colaría el chequeo de tamaño del lado de Postgres dejando
    // una parada sin renumerar. La base también lo rechaza; aquí se corta antes.
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Hay paradas repetidas en el orden",
    ),
});

export async function reordenarParadas(
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = reordenarSchema.safeParse(datos);
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };

  const sesion = await sesionDeStaff();
  if (!sesion) return { ok: false, error: SIN_PERMISO };
  const { supabase } = sesion;

  const { error } = await supabase.rpc("reordenar_paradas", {
    p_rutero_id: parsed.data.ruteroId,
    p_paradas: parsed.data.paradas,
  });
  if (error) return fallo("reordenarParadas", error);

  revalidatePath(SECCION);
  return { ok: true };
}

/**
 * Publicar es lo que hace que el rutero exista para el mercaderista: la sync
 * rule solo baja al teléfono lo que no está en borrador.
 */
export async function publicarRutero(datos: unknown): Promise<ResultadoAccion> {
  const parsed = z.object({ ruteroId: id }).safeParse(datos);
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };

  const sesion = await sesionDeStaff();
  if (!sesion) return { ok: false, error: SIN_PERMISO };
  const { supabase } = sesion;

  const { data, error } = await supabase
    .from("rutero")
    .update({ estado: "publicado" })
    .eq("id", parsed.data.ruteroId)
    // Solo un borrador se publica: reescribir un `en_curso` retrocedería el
    // estado de una jornada ya empezada.
    .eq("estado", "borrador")
    .select("id");
  if (error) return fallo("publicarRutero", error);
  if (data.length === 0) return { ok: false, error: SIN_PERMISO };

  revalidatePath(SECCION);
  return { ok: true };
}

const duplicarSchema = z.object({
  mercaderistaId: id,
  desde: fecha,
  hasta: fecha,
  dias: z
    .number()
    .int()
    .refine((n) => n !== 0, "El desplazamiento no puede ser cero"),
});

/** Copia el periodo sobre el siguiente. Siempre como borrador. */
export async function duplicarPeriodo(
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = duplicarSchema.safeParse(datos);
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };

  const sesion = await sesionDeStaff();
  if (!sesion) return { ok: false, error: SIN_PERMISO };
  const { supabase } = sesion;

  const { error } = await supabase.rpc("duplicar_periodo_rutero", {
    p_mercaderista: parsed.data.mercaderistaId,
    p_desde: parsed.data.desde,
    p_hasta: parsed.data.hasta,
    p_dias_desplazamiento: parsed.data.dias,
  });
  if (error) return fallo("duplicarPeriodo", error);

  revalidatePath(SECCION);
  return { ok: true };
}
