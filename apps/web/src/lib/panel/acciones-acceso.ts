"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { canalOtpSchema } from "@market-track/shared";

import { env } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { canalesConCorreo } from "./acceso";

const FUNCION_TIMEOUT_MS = 10_000;

// Las dos rutas que enseñan pases: cualquiera de las dos acciones puede haberse
// disparado desde una u otra.
const SECCIONES = ["/admin/acceso", "/supervisor/acceso"] as const;

// Un UPDATE que la RLS bloquea NO da error: afecta a 0 filas y devuelve éxito.
// Por eso toda escritura pide `.select()` y comprueba que volvió algo.
const SIN_PERMISO = "No encontrado o sin permiso";

export type ResultadoPase =
  { ok: true; codigo: string; expiraAt: string } | { ok: false; error: string };

export type ResultadoAcceso = { ok: true } | { ok: false; error: string };

function revalidarAmbas(): void {
  for (const seccion of SECCIONES) revalidatePath(seccion);
}

// `z.guid()`, no `z.uuid()`: el estricto exige bits de versión RFC 9562 que
// Postgres no impone y que los ids del propio seed no cumplen.
const emitirSchema = z.object({
  profileId: z.guid(),
  // El motivo es obligatorio y el tope espeja el de la Edge Function: cortar
  // aquí evita un viaje para que lo rechacen igual.
  motivo: z.string().trim().min(1, "Explica por qué se emite").max(500),
});

/**
 * Emite un pase de acceso temporal delegando en la Edge Function.
 *
 * Toda la parte delicada —randomness criptográfica, HMAC del código, alcance por
 * rol replicado en servidor, límite diario— vive allí y corre con `service_role`.
 * Aquí solo se valida y se reenvía el JWT de quien llama para que la función haga
 * su propia autorización.
 *
 * El código vuelve UNA sola vez. No se registra en ningún log: quien lo tuviera
 * podría entrar como ese mercaderista.
 */
export async function emitirPase(datos: unknown): Promise<ResultadoPase> {
  const parsed = emitirSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos",
    };
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: "No autenticado" };

  let res: Response;
  try {
    res = await fetch(`${env.SUPABASE_URL}/functions/v1/emitir-pase`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: env.SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        profile_id: parsed.data.profileId,
        motivo: parsed.data.motivo,
      }),
      signal: AbortSignal.timeout(FUNCION_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(
      "[acceso] fallo al llamar emitir-pase",
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false, error: "No se pudo emitir el pase" };
  }

  const cuerpo = (await res.json().catch(() => null)) as {
    id?: string;
    codigo?: string;
    expira_at?: string;
    error?: string;
  } | null;

  if (!res.ok) {
    return { ok: false, error: cuerpo?.error ?? `Error ${res.status}` };
  }
  if (!cuerpo?.codigo || !cuerpo.expira_at) {
    console.error("[acceso] emitir-pase devolvió una respuesta incompleta");
    return { ok: false, error: "No se pudo emitir el pase" };
  }

  // Se registra el id, NUNCA el código.
  console.info(
    JSON.stringify({
      evento: "pase_emitido",
      pase_id: cuerpo.id,
      profile_id: parsed.data.profileId,
    }),
  );

  revalidarAmbas();
  return { ok: true, codigo: cuerpo.codigo, expiraAt: cuerpo.expira_at };
}

const revocarSchema = z.object({ paseId: z.guid() });

/**
 * Revoca un pase vigente.
 *
 * Escribe solo `revocado_at`, y no porque se elija aquí: el grant de la base está
 * restringido a esa columna y un trigger pone la hora del servidor y rechaza
 * revocar lo que ya se usó o venció. La bitácora es inmutable en la base.
 */
export async function revocarPase(datos: unknown): Promise<ResultadoAcceso> {
  const parsed = revocarSchema.safeParse(datos);
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("pase_acceso_temporal")
    .update({ revocado_at: new Date().toISOString() })
    .eq("id", parsed.data.paseId)
    // Columnas explícitas: un `select()` a secas pediría `codigo_hash`, que no
    // tiene grant de lectura, y moriría con 42501.
    .select("id, revocado_at");

  if (error) {
    // El trigger rechaza revocar lo ya usado o vencido. Es una carrera normal
    // —el pase pudo vencer entre el render y el clic—, no un fallo del operador.
    console.error("[acceso] revocarPase", error.message.slice(0, 200));
    return { ok: false, error: "El pase ya no está vigente" };
  }
  // Cero filas: no existe o la RLS lo esconde. Se responde igual a los dos casos.
  if (!data?.[0]) return { ok: false, error: SIN_PERMISO };

  console.info(
    JSON.stringify({ evento: "pase_revocado", pase_id: parsed.data.paseId }),
  );

  revalidarAmbas();
  return { ok: true };
}

const canalesSchema = z.object({
  canales: z.array(canalOtpSchema).min(1),
});

/**
 * Guarda los canales de OTP habilitados.
 *
 * Es política GLOBAL de la outsourcing, no de cada cliente: el staff no pertenece
 * a ninguno. El correo entra siempre — la regla la impone un CHECK de la base;
 * aquí solo se normaliza para dar un mensaje mejor que un error de constraint.
 */
export async function guardarCanalesOtp(
  datos: unknown,
): Promise<ResultadoAcceso> {
  const parsed = canalesSchema.safeParse(datos);
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("configuracion_plataforma")
    .update({ otp_canales_habilitados: canalesConCorreo(parsed.data.canales) })
    .eq("id", true)
    .select("id");

  if (error) {
    console.error("[acceso] guardarCanalesOtp", error.message.slice(0, 200));
    return { ok: false, error: "No se pudo guardar la política de acceso" };
  }
  if (!data?.[0]) return { ok: false, error: SIN_PERMISO };

  console.info(
    JSON.stringify({
      evento: "canales_otp_actualizados",
      canales: canalesConCorreo(parsed.data.canales),
    }),
  );

  revalidarAmbas();
  return { ok: true };
}
