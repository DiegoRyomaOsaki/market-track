// Canjea el pase de acceso temporal: el mercaderista que no recibe su OTP dicta
// al supervisor su situación, el supervisor le emite un pase (`emitir-pase`) y le
// lee el código de 6 dígitos; el mercaderista lo teclea en el login y llega aquí
// con su sesión de solo contraseña (aal1).
//
// Lo que hace: reproduce el HMAC del código (`_shared/pase.ts`, el mismo formato
// que guardó `emitir-pase`), lo compara EN TIEMPO CONSTANTE contra los pases
// vigentes del propio llamante, y marca el que coincide como usado por ESTA
// sesión (`public.canjear_pase`: un solo UPDATE atómico, un solo uso real bajo
// concurrencia). Vencido, usado o revocado no entran ni en la lista de candidatos:
// la definición de "vigente" es de `app.estado_pase()`, no de aquí.
//
// Lo que NO hace: emitir un token. No existe API de admin que eleve una sesión a
// aal2 (ADR-0008, punto 2). La elevación la hace el Custom Access Token Hook de
// GoTrue al SIGUIENTE token de esta sesión: ve la marca `usado_por_sesion` y sube
// el claim `aal` a `aal2`. Por eso la respuesta le pide al cliente que refresque
// la sesión — el token nuevo ya llega elevado, y RLS, sync del móvil y middleware
// siguen leyendo el mismo claim de siempre.
//
// Corre con SERVICE_ROLE (`codigo_hash` no tiene grant de lectura, a propósito):
// la autorización es "solo tus propios pases", y el propio pase se acota a la
// sesión que lo canjeó.
//
// La validación del payload vive en esta frontera (Zod). Se define local y no en
// packages/shared porque las Edge Functions corren en Deno y no consumen el
// workspace de pnpm.

import { z } from "npm:zod@4";

import {
  clienteDelLlamante,
  clienteServicio,
  json,
} from "../_shared/supabase.ts";
import { hashCodigo, paseQueCoincide } from "../_shared/pase.ts";

// Fail-closed: sin el secreto no se puede reproducir el hash, así que la función
// NO arranca — nunca un fallback que lo abra.
const PASE_HASH_SECRET = Deno.env.get("PASE_HASH_SECRET");
if (!PASE_HASH_SECRET) {
  throw new Error(
    "PASE_HASH_SECRET no configurado: la función no arranca (fail-closed)",
  );
}

// Deadline de las consultas: una llamada colgada a Postgres no debe bloquear la
// respuesta ni consumir el presupuesto de la función.
const DB_TIMEOUT_MS = 8_000;

const canjearPaseSchema = z.object({
  codigo: z.string().regex(/^\d{6}$/),
});

// Una sola respuesta para "no coincide", "vencido", "usado" y "revocado": quien
// prueba códigos a ciegas no debe distinguir cuál de las cuatro fue.
const RECHAZO = { error: "código inválido o pase no vigente" } as const;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "método no permitido" });

  // Frontera: el cuerpo es de un tercero hasta que Zod lo valida.
  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return json(400, { error: "cuerpo no es JSON válido" });
  }
  const parsed = canjearPaseSchema.safeParse(cuerpo);
  if (!parsed.success) {
    return json(400, {
      error: "payload inválido",
      detalles: parsed.error.issues,
    });
  }
  const { codigo } = parsed.data;

  // Autenticación: ¿quién llama y con qué sesión? `getClaims(token)` verifica el
  // JWT (con clave simétrica, contra el servidor de Auth vía getUser) y devuelve
  // sus claims ya fiables: de ahí salen el usuario (sub), la sesión a la que se
  // ata el pase (session_id) y su aal. El token se pasa explícito: este cliente
  // no tiene sesión propia, solo el header del llamante.
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "no autenticado" });
  const llamante = clienteDelLlamante(req);
  const { data: verificado, error: errClaims } =
    await llamante.auth.getClaims(token);
  if (errClaims || !verificado) return json(401, { error: "no autenticado" });
  const { sub: profileId, session_id: sesionId, aal } = verificado.claims;
  if (!sesionId) return json(401, { error: "la sesión no es canjeable" });
  // Una sesión que ya completó el segundo factor no necesita el pase: no se
  // consume uno por gusto.
  if (aal === "aal2") {
    return json(409, { error: "la sesión ya tiene segundo factor" });
  }

  const servicio = clienteServicio();

  // Solo los pases VIGENTES del propio llamante. `expira_at` se prefiltra aquí y
  // lo re-evalúa la base al marcar: la autoridad del reloj es Postgres.
  const { data: candidatos, error: errCandidatos } = await servicio
    .from("pase_acceso_temporal")
    .select("id, codigo_hash")
    .eq("profile_id", profileId)
    .is("usado_at", null)
    .is("revocado_at", null)
    .gt("expira_at", new Date().toISOString())
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (errCandidatos) {
    return json(500, { error: "no se pudieron leer los pases" });
  }

  const hashDado = await hashCodigo(codigo, PASE_HASH_SECRET);
  const pase = paseQueCoincide(hashDado, candidatos ?? []);

  if (!pase) {
    // Se cuenta el fallo sobre los pases vigentes del usuario; al tope, la base
    // los revoca sola. Si la cuenta falla, se rechaza igual: la puerta sigue
    // cerrada, solo se pierde la cota.
    const { data: quemados, error: errFallo } = await servicio
      .rpc("pase_intento_fallido", { p_profile_id: profileId })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    console.warn(
      JSON.stringify({
        evento: "pase_canje_rechazado",
        profile_id: profileId,
        session_id: sesionId,
        candidatos: candidatos?.length ?? 0,
        pases_quemados: errFallo ? null : quemados,
        detalle: errFallo ? errFallo.message.slice(0, 200) : undefined,
      }),
    );
    return json(401, RECHAZO);
  }

  // Marcar el pase como usado por esta sesión: un solo UPDATE atómico. `false`
  // = alguien lo marcó antes (o dejó de estar vigente entre la lectura y aquí).
  const { data: marcado, error: errCanje } = await servicio
    .rpc("canjear_pase", { p_pase_id: pase.id, p_sesion_id: sesionId })
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (errCanje) {
    return json(500, {
      error: "no se pudo canjear el pase",
      detalle: errCanje.message.slice(0, 200),
    });
  }
  if (!marcado) {
    console.warn(
      JSON.stringify({
        evento: "pase_canje_perdido",
        pase_id: pase.id,
        profile_id: profileId,
        session_id: sesionId,
      }),
    );
    return json(401, RECHAZO);
  }

  // Auditoría: la fila ya ES la bitácora (usado_at, usado_por_sesion); esta línea
  // traza el canje en los logs.
  console.log(
    JSON.stringify({
      evento: "pase_canjeado",
      pase_id: pase.id,
      profile_id: profileId,
      session_id: sesionId,
    }),
  );

  // El token que ya tiene el cliente sigue siendo aal1: la elevación llega con el
  // siguiente que emita GoTrue para esta sesión (refreshSession).
  return json(
    200,
    { pase_id: pase.id, siguiente_paso: "refrescar_sesion" },
    { "Cache-Control": "no-store" },
  );
});
