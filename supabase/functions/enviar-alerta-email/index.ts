// Envía por email (Resend) las alertas relevantes al brand manager del cliente.
// La invoca un Database Webhook (trigger pg_net) al insertarse una alerta — de
// forma asíncrona, para no bloquear la escritura del sync.
//
// SEGURIDAD: el webhook comparte un secreto OBLIGATORIO (fail-closed) y del cuerpo
// solo se confía el `id`: la alerta se RE-LEE de la base, así un cuerpo forjado no
// puede elegir el tenant ni el contenido del email.
//
// El envío real es un punto de integración: sin RESEND_API_KEY corre en DRY-RUN
// (no manda nada, devuelve a quién habría enviado).

import { z } from "npm:zod@4";

import { igualesEnTiempoConstante } from "../_shared/secreto.ts";
import { clienteServicio, json } from "../_shared/supabase.ts";

const TIPOS_EMAIL = new Set(["quiebre", "desviacion_precio"]);
const RESEND_TIMEOUT_MS = 10_000;
const MAX_PAYLOAD_HTML = 4_000;

// Fail-closed: el secreto es la ÚNICA puerta de este endpoint (revela correos y
// manda email). Sin él, la función NO arranca — nunca un fallback que lo abra.
const WEBHOOK_SECRET = Deno.env.get("ALERTA_WEBHOOK_SECRET");
if (!WEBHOOK_SECRET) {
  throw new Error(
    "ALERTA_WEBHOOK_SECRET no configurado: la función no arranca (fail-closed)",
  );
}

// Del webhook solo se confía el id; el resto se re-lee de la base.
const webhookSchema = z.object({ record: z.object({ id: z.guid() }) });

/** Escapa lo que se interpola en el HTML del email. */
function esc(v: unknown): string {
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Recorta a n chars: los mensajes de infra pueden arrastrar contenido de más. */
function recorta(s: string, n = 200): string {
  return s.length > n ? s.slice(0, n) : s;
}

/** Race entre la llamada y un deadline; un AbortController corta el fetch de verdad. */
async function fetchConTimeout(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "método no permitido" });

  // Secreto obligatorio, comparación en tiempo constante.
  if (
    !igualesEnTiempoConstante(
      req.headers.get("x-webhook-secret") ?? "",
      WEBHOOK_SECRET,
    )
  ) {
    return json(401, { error: "secreto de webhook inválido" });
  }

  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return json(400, { error: "cuerpo no es JSON válido" });
  }
  const parsed = webhookSchema.safeParse(cuerpo);
  if (!parsed.success) {
    return json(400, {
      error: "payload inválido",
      detalles: parsed.error.issues,
    });
  }

  const servicio = clienteServicio();

  // RE-LEE la alerta real: no se confía en los campos de negocio del cuerpo.
  const { data: alerta, error: errAlerta } = await servicio
    .from("alerta")
    .select("id, tenant_id, tipo, severidad, payload")
    .eq("id", parsed.data.record.id)
    .single();
  if (errAlerta || !alerta) {
    return json(404, { error: "alerta no encontrada" });
  }

  if (!TIPOS_EMAIL.has(alerta.tipo)) {
    return json(200, {
      enviado: false,
      motivo: "tipo no relevante para email",
    });
  }

  // Destinatarios en UNA consulta (evita el N+1 de getUserById): función SQL que
  // joinea profile + auth.users, scopeada al tenant de la alerta.
  const { data: filas, error: errCorreos } = await servicio.rpc(
    "correos_clientes_del_tenant",
    { p_tenant: alerta.tenant_id },
  );
  if (errCorreos) {
    return json(500, {
      error: "no se pudieron leer los destinatarios",
      detalle: recorta(errCorreos.message),
    });
  }
  const correos = ((filas ?? []) as { correo: string }[]).map((f) => f.correo);
  if (correos.length === 0) {
    return json(200, {
      enviado: false,
      motivo: "el tenant no tiene clientes con correo",
    });
  }

  // Asunto en texto plano (sin escapar HTML); el cuerpo HTML sí se escapa.
  const asunto = `Alerta ${alerta.tipo} · Market Track`;
  const payloadStr = recorta(
    JSON.stringify(alerta.payload ?? {}, null, 2),
    MAX_PAYLOAD_HTML,
  );
  const html = `<p>Se registró una alerta de tipo <b>${esc(alerta.tipo)}</b> (severidad ${esc(alerta.severidad)}).</p>
<pre>${esc(payloadStr)}</pre>`;

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM") ?? "alertas@market-track.local";

  // DRY-RUN: sin API key no se manda nada (local/tests). Punto de integración.
  if (!apiKey) {
    return json(200, { enviado: false, dryRun: true, destinatarios: correos });
  }

  try {
    const res = await fetchConTimeout(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: correos, subject: asunto, html }),
      },
      RESEND_TIMEOUT_MS,
    );
    if (!res.ok) {
      return json(502, {
        error: "Resend rechazó el envío",
        detalle: recorta(await res.text()),
      });
    }
    return json(200, { enviado: true, destinatarios: correos });
  } catch (err) {
    return json(504, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
