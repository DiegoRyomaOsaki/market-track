// Emite el pase de acceso temporal: el rescate para el usuario de campo que no
// recibe su OTP. Genera un código de 6 dígitos con randomness criptográfica, lo
// devuelve UNA sola vez para dictarlo, y guarda solo su hash. La tabla
// `pase_acceso_temporal` ya está endurecida (un solo uso, 15 min por CHECK,
// `generado_por` atado a quien emite, `codigo_hash` sin grant de lectura).
//
// Corre con SERVICE_ROLE (salta la RLS) porque el servidor es quien acuña el
// código: por eso la autorización por rol se replica AQUÍ a propósito —es el
// mismo criterio que la política RLS de la tabla, no un segundo camino.
//
// El canje (`canjear-pase`) y la elevación de la sesión a `aal2` NO viven aquí:
// dependen del modelo de enforcement del 2FA (ADR-0008) y se construyen con él.
//
// La validación del payload vive en esta frontera (Zod). Se define local y no en
// packages/shared porque las Edge Functions corren en Deno y no consumen el
// workspace de pnpm; es la única copia de esta forma.

import { z } from "npm:zod@4";

import {
  clienteDelLlamante,
  clienteServicio,
  json,
} from "../_shared/supabase.ts";
import { generarCodigo, hashCodigo } from "../_shared/pase.ts";

// Fail-closed: sin el secreto no se puede acuñar el hash del código, así que la
// función NO arranca — nunca un fallback que lo abra (igual que el webhook).
const PASE_HASH_SECRET = Deno.env.get("PASE_HASH_SECRET");
if (!PASE_HASH_SECRET) {
  throw new Error(
    "PASE_HASH_SECRET no configurado: la función no arranca (fail-closed)",
  );
}

// Cota antiabuso: cuántos pases se pueden emitir a un mismo usuario en 24 h.
const LIMITE_DIARIO = 3;
const VENTANA_MS = 24 * 60 * 60 * 1000;

const emitirPaseSchema = z.object({
  profile_id: z.guid(),
  motivo: z.string().min(1),
});

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "método no permitido" });

  // Frontera: el cuerpo es de un tercero hasta que Zod lo valida.
  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return json(400, { error: "cuerpo no es JSON válido" });
  }
  const parsed = emitirPaseSchema.safeParse(cuerpo);
  if (!parsed.success) {
    return json(400, {
      error: "payload inválido",
      detalles: parsed.error.issues,
    });
  }
  const { profile_id, motivo } = parsed.data;

  // Autenticación: ¿quién llama?
  const llamante = clienteDelLlamante(req);
  const { data: auth } = await llamante.auth.getUser();
  if (!auth.user) return json(401, { error: "no autenticado" });

  const servicio = clienteServicio();

  // Perfil del emisor (rol) y del objetivo (para el alcance del supervisor).
  const { data: emisor } = await servicio
    .from("profile")
    .select("id, rol")
    .eq("id", auth.user.id)
    .single();
  if (!emisor) return json(403, { error: "el llamante no tiene perfil" });

  const { data: objetivo } = await servicio
    .from("profile")
    .select("id, supervisor_id")
    .eq("id", profile_id)
    .single();
  if (!objetivo) return json(404, { error: "usuario objetivo no encontrado" });

  // Autorización SIEMPRE en el servidor: admin a cualquiera; supervisor solo a
  // quien le reporta. Mismo criterio que la RLS de la tabla, que aquí se salta.
  const esAdmin = emisor.rol === "admin";
  const esSupervisorDelObjetivo =
    emisor.rol === "supervisor" && objetivo.supervisor_id === emisor.id;
  if (!esAdmin && !esSupervisorDelObjetivo) {
    return json(403, {
      error: "sin permiso para emitir un pase a este usuario",
    });
  }

  // Límite diario por usuario objetivo: pases no revocados en las últimas 24 h.
  const desde = new Date(Date.now() - VENTANA_MS).toISOString();
  const { count, error: errConteo } = await servicio
    .from("pase_acceso_temporal")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profile_id)
    .is("revocado_at", null)
    .gte("generado_at", desde);
  if (errConteo) {
    return json(500, { error: "no se pudo verificar el límite diario" });
  }
  if ((count ?? 0) >= LIMITE_DIARIO) {
    return json(429, {
      error: "límite diario de pases alcanzado para este usuario",
    });
  }

  // Código de 6 dígitos + su HMAC. El código se revela UNA vez; se guarda el hash.
  const codigo = generarCodigo();
  const codigo_hash = await hashCodigo(codigo, PASE_HASH_SECRET);

  // `expira_at` lo pone el default de la tabla (now() + 15 min, acotado por CHECK).
  const { data: creado, error: errInsert } = await servicio
    .from("pase_acceso_temporal")
    .insert({ profile_id, codigo_hash, motivo, generado_por: emisor.id })
    .select("id, expira_at")
    .single();
  if (errInsert || !creado) {
    return json(400, {
      error: "no se pudo emitir el pase",
      // Recortado: los mensajes de infra pueden arrastrar contenido de más.
      detalle: errInsert?.message.slice(0, 200),
    });
  }

  // Auditoría: la fila insertada ya ES la bitácora (generado_por, generado_at,
  // motivo); esta línea estructurada —SIN el código— traza la emisión en logs.
  console.log(
    JSON.stringify({
      evento: "pase_emitido",
      pase_id: creado.id,
      profile_id,
      generado_por: emisor.id,
    }),
  );

  return json(201, { id: creado.id, codigo, expira_at: creado.expira_at });
});
