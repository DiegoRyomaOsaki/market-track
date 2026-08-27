// Emite el pase de acceso temporal: el rescate para el mercaderista que no recibe
// su OTP. Genera un código de 6 dígitos con randomness criptográfica, lo devuelve
// UNA sola vez para dictarlo, y guarda solo su hash. La tabla
// `pase_acceso_temporal` ya está endurecida (un solo uso, 15 min por CHECK,
// `generado_por` atado a quien emite, `codigo_hash` sin grant de lectura).
//
// Corre con SERVICE_ROLE (salta la RLS) porque el servidor es quien acuña el
// código: por eso la autorización se replica AQUÍ a propósito —en `puedeEmitirPase`,
// el mismo criterio que la política RLS de la tabla, endurecido a solo-mercaderista
// y sin filtrar existencia entre tenants— no es un segundo camino.
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
import {
  falloAlEmitir,
  generarCodigo,
  hashCodigo,
  puedeEmitirPase,
} from "../_shared/pase.ts";

// Fail-closed: sin el secreto no se puede acuñar el hash del código, así que la
// función NO arranca — nunca un fallback que lo abra (igual que el webhook).
const PASE_HASH_SECRET = Deno.env.get("PASE_HASH_SECRET");
if (!PASE_HASH_SECRET) {
  throw new Error(
    "PASE_HASH_SECRET no configurado: la función no arranca (fail-closed)",
  );
}

// Deadline de las consultas: una llamada colgada a Postgres no debe bloquear la
// respuesta ni consumir el presupuesto de la función (Deno `fetch` no trae timeout).
const DB_TIMEOUT_MS = 8_000;

const emitirPaseSchema = z.object({
  profile_id: z.guid(),
  // Acotado: el motivo de un pase de emergencia es corto, y un string sin tope es
  // relleno barato de la auditoría.
  motivo: z.string().min(1).max(500),
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

  // Emisor y objetivo en UNA consulta (dos round-trips serían latencia de más en
  // el camino crítico). `abortSignal` acota el cuelgue de Postgres.
  const { data: perfiles, error: errPerfiles } = await servicio
    .from("profile")
    .select("id, rol, supervisor_id")
    .in("id", [auth.user.id, profile_id])
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (errPerfiles) {
    return json(500, { error: "no se pudieron leer los perfiles" });
  }
  const emisor = (perfiles ?? []).find((p) => p.id === auth.user!.id) ?? null;
  if (!emisor) return json(403, { error: "el llamante no tiene perfil" });
  const objetivo = (perfiles ?? []).find((p) => p.id === profile_id) ?? null;

  // Autorización SIEMPRE en el servidor (service_role salta la RLS de la tabla).
  const decision = puedeEmitirPase(emisor, objetivo);
  if (!decision.permitido) {
    return json(decision.status, { error: decision.error });
  }

  // Código de 6 dígitos + su HMAC. El código se revela UNA vez; se guarda el hash.
  const codigo = generarCodigo();
  const codigo_hash = await hashCodigo(codigo, PASE_HASH_SECRET);

  // `expira_at` lo pone el default de la tabla (now() + 15 min, acotado por CHECK).
  const { data: creado, error: errInsert } = await servicio
    .from("pase_acceso_temporal")
    .insert({ profile_id, codigo_hash, motivo, generado_por: emisor.id })
    .select("id, expira_at")
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    .single();
  if (errInsert || !creado) {
    // El tope lo impone el trigger `pase_tope_por_ventana`, no esta función: es
    // la única forma de que no se pueda rodear insertando directo por PostgREST,
    // y de que dos emisiones simultáneas no pasen las dos. Aquí solo se traduce
    // su rechazo al 429 que el cliente ya esperaba.
    //
    // Por el CÓDIGO y no por el texto del mensaje: un mensaje es copy y cambia;
    // el SQLSTATE es el contrato.
    const fallo = falloAlEmitir(errInsert?.code);
    return json(fallo.estado, {
      error: fallo.error,
      // El detalle solo acompaña al 500: en el 429 la causa ya la dice el
      // mensaje, y adjuntar el error de infraestructura no le aporta nada a
      // quien llama. Recortado, porque puede arrastrar contenido de más.
      ...(fallo.estado === 500
        ? { detalle: errInsert?.message.slice(0, 200) }
        : {}),
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

  // El código va en claro una sola vez: `no-store` para que ningún intermediario
  // (proxy, caché) lo retenga.
  return json(
    201,
    { id: creado.id, codigo, expira_at: creado.expira_at },
    { "Cache-Control": "no-store" },
  );
});
