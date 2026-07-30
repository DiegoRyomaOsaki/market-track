"use server";

import { revalidatePath } from "next/cache";

import type { Json } from "@market-track/db";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  altaFormularioSchema,
  type DefinicionBorrador,
  guardarBorradorSchema,
  publicarSchema,
} from "./schema";

export type ResultadoAccion =
  { ok: true } | { ok: false; error: string; detalles?: unknown };

export type ResultadoCreacion =
  { ok: true; id: string } | { ok: false; error: string; detalles?: unknown };

const SECCION = "/admin/formularios";

// Un UPDATE/INSERT que la RLS bloquea NO da error: afecta a 0 filas y devuelve
// éxito. Por eso toda escritura pide `.select()` y comprueba que volvió algo.
const SIN_PERMISO = "No encontrado o sin permiso";

function fallo(
  operacion: string,
  mensaje: string,
  visible: string,
): { ok: false; error: string } {
  // El mensaje del driver puede arrastrar contenido de la respuesta: se recorta
  // para el log y NUNCA se devuelve al navegador tal cual.
  console.error(`[formularios] ${operacion}`, mensaje.slice(0, 200));
  return { ok: false, error: visible };
}

export async function crearFormulario(
  datos: unknown,
): Promise<ResultadoCreacion> {
  const parsed = altaFormularioSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos inválidos",
      detalles: parsed.error.issues,
    };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("formulario_levantamiento")
    .insert({
      nombre: parsed.data.nombre,
      tenant_id: parsed.data.tenant_id,
      marca_id: parsed.data.marca_id,
    })
    .select("id")
    .maybeSingle();

  if (error)
    return fallo(
      "alta de formulario",
      error.message,
      "No se pudo crear el formulario",
    );
  if (!data) return { ok: false, error: SIN_PERMISO };

  revalidatePath(SECCION);
  return { ok: true, id: data.id };
}

export async function guardarBorrador(
  formularioId: string,
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = guardarBorradorSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos inválidos",
      detalles: parsed.error.issues,
    };
  }

  const guardado = await guardarCabeceraYBorrador(
    formularioId,
    parsed.data.nombre,
    parsed.data.activo,
    parsed.data.definicion,
  );
  if (!guardado.ok) return guardado;

  revalidarFormulario(formularioId);
  return { ok: true };
}

export async function publicarFormulario(
  formularioId: string,
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = publicarSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      error: "El formulario tiene errores; corrígelos antes de publicar",
      detalles: parsed.error.issues,
    };
  }

  // Se guarda primero (cabecera + borrador con esta definición) y luego se
  // congela ese mismo borrador: publicar es exactamente lo que se ve.
  const guardado = await guardarCabeceraYBorrador(
    formularioId,
    parsed.data.nombre,
    parsed.data.activo,
    parsed.data.definicion,
  );
  if (!guardado.ok) return guardado;

  const supabase = await createServerSupabaseClient();
  const { data: sesion } = await supabase.auth.getUser();
  const publicadaPor = sesion.user?.id ?? null;

  const { data, error } = await supabase
    .from("formulario_version")
    .update({
      publicada: true,
      publicada_at: new Date().toISOString(),
      publicada_por: publicadaPor,
    })
    .eq("id", guardado.versionId)
    .select("id")
    .maybeSingle();

  if (error)
    return fallo(
      "publicación de formulario",
      error.message,
      "No se pudo publicar el formulario",
    );
  if (!data) return { ok: false, error: SIN_PERMISO };

  revalidarFormulario(formularioId);
  return { ok: true };
}

type GuardadoBorrador =
  { ok: true; versionId: string } | { ok: false; error: string };

/**
 * Guarda la cabecera y deja la definición en el BORRADOR abierto. Si no hay
 * borrador (la última versión está publicada, o no hay ninguna) abre una versión
 * nueva: nunca toca una publicada, que es inmutable y ya la usan las visitas en
 * curso. Devuelve el id de la versión-borrador tocada.
 */
async function guardarCabeceraYBorrador(
  formularioId: string,
  nombre: string,
  activo: boolean,
  definicion: DefinicionBorrador,
): Promise<GuardadoBorrador> {
  const supabase = await createServerSupabaseClient();

  const { data: cabecera, error: errorCabecera } = await supabase
    .from("formulario_levantamiento")
    .update({ nombre, activo })
    .eq("id", formularioId)
    .select("id, tenant_id")
    .maybeSingle();
  if (errorCabecera)
    return fallo(
      "edición de formulario",
      errorCabecera.message,
      "No se pudo guardar el formulario",
    );
  if (!cabecera) return { ok: false, error: SIN_PERMISO };

  // El jsonb acepta cualquier JSON; la definición ya pasó por Zod en la frontera.
  // El tipo inferido de Zod trae props opcionales (`min?`) que `Json` no admite
  // (no acepta `undefined`), de ahí el cast puntual.
  const definicionJson = definicion as unknown as Json;

  const { data: borrador, error: errorBorrador } = await supabase
    .from("formulario_version")
    .select("id")
    .eq("formulario_id", formularioId)
    .eq("publicada", false)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (errorBorrador)
    return fallo(
      "lectura de borrador",
      errorBorrador.message,
      "No se pudo guardar el formulario",
    );

  if (borrador) {
    const { data, error } = await supabase
      .from("formulario_version")
      .update({ definicion: definicionJson })
      .eq("id", borrador.id)
      .select("id")
      .maybeSingle();
    if (error)
      return fallo(
        "guardado de borrador",
        error.message,
        "No se pudo guardar el formulario",
      );
    if (!data) return { ok: false, error: SIN_PERMISO };
    return { ok: true, versionId: data.id };
  }

  const { data: ultima, error: errorUltima } = await supabase
    .from("formulario_version")
    .select("version")
    .eq("formulario_id", formularioId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (errorUltima)
    return fallo(
      "lectura de versión",
      errorUltima.message,
      "No se pudo guardar el formulario",
    );

  const siguiente = (ultima?.version ?? 0) + 1;
  const { data, error } = await supabase
    .from("formulario_version")
    .insert({
      formulario_id: formularioId,
      tenant_id: cabecera.tenant_id,
      version: siguiente,
      definicion: definicionJson,
      publicada: false,
    })
    .select("id")
    .maybeSingle();
  if (error)
    return fallo(
      "apertura de versión",
      error.message,
      "No se pudo guardar el formulario",
    );
  if (!data) return { ok: false, error: SIN_PERMISO };
  return { ok: true, versionId: data.id };
}

function revalidarFormulario(formularioId: string) {
  revalidatePath(SECCION);
  revalidatePath(`${SECCION}/${formularioId}`);
}
