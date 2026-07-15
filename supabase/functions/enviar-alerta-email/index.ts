// Envía por email (Resend) las alertas relevantes al brand manager del cliente.
// La invoca un Database Webhook (trigger pg_net) al insertarse una alerta — de
// forma asíncrona, para no bloquear la escritura del sync.
//
// El envío real es un punto de integración: sin RESEND_API_KEY corre en DRY-RUN
// (no manda nada, devuelve a quién habría enviado) — así se prueba la lógica sin
// mandar correos de verdad.

import { z } from "npm:zod@4";

import { clienteServicio, json } from "../_shared/supabase.ts";

// Solo estos tipos van por email; el resto vive en el dashboard. El toggle por
// cliente es de MAR-59 (el portal); aquí el default es enviar los relevantes.
const TIPOS_EMAIL = new Set(["quiebre", "desviacion_precio"]);

const RESEND_TIMEOUT_MS = 10_000;

const alertaSchema = z.object({
  id: z.guid(),
  tenant_id: z.guid(),
  tipo: z.string(),
  marca_id: z.guid().nullish(),
  visita_id: z.guid().nullish(),
  severidad: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

const webhookSchema = z.object({ record: alertaSchema });

/** Escapa lo que se interpola en el HTML del email. Los valores vienen de
 * nuestro motor de alertas (controlados), pero escapar es barato y cierra la
 * puerta a cualquier inyección si un día un payload arrastra texto de usuario. */
function esc(v: unknown): string {
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Race entre la llamada y un deadline: un Resend colgado no quema la función. */
function conTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timeout de Resend")), ms),
    ),
  ]);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "método no permitido" });

  // El webhook comparte un secreto. Si está configurado, se exige.
  const secretoEsperado = Deno.env.get("ALERTA_WEBHOOK_SECRET");
  if (
    secretoEsperado &&
    req.headers.get("x-webhook-secret") !== secretoEsperado
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
  const alerta = parsed.data.record;

  // Cuatro caminos: tipo no relevante = nada que hacer.
  if (!TIPOS_EMAIL.has(alerta.tipo)) {
    return json(200, {
      enviado: false,
      motivo: "tipo no relevante para email",
    });
  }

  const servicio = clienteServicio();

  // Destinatarios: los clientes (brand managers) del tenant de la alerta. Solo
  // su tenant → el email nunca cruza datos entre clientes.
  const { data: perfiles, error: errPerfiles } = await servicio
    .from("profile")
    .select("id")
    .eq("tenant_id", alerta.tenant_id)
    .eq("rol", "cliente")
    .eq("activo", true);
  if (errPerfiles) {
    return json(500, {
      error: "no se pudieron leer los destinatarios",
      detalle: errPerfiles.message,
    });
  }

  const correos: string[] = [];
  for (const p of perfiles ?? []) {
    const { data } = await servicio.auth.admin.getUserById(p.id);
    if (data.user?.email) correos.push(data.user.email);
  }
  if (correos.length === 0) {
    return json(200, {
      enviado: false,
      motivo: "el tenant no tiene clientes con correo",
    });
  }

  const asunto = `Alerta ${esc(alerta.tipo)} · Market Track`;
  const html = `<p>Se registró una alerta de tipo <b>${esc(alerta.tipo)}</b> (severidad ${esc(alerta.severidad)}).</p>
<pre>${esc(JSON.stringify(alerta.payload, null, 2))}</pre>`;

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM") ?? "alertas@market-track.local";

  // DRY-RUN: sin API key no se manda nada (local/tests). Punto de integración.
  if (!apiKey) {
    return json(200, { enviado: false, dryRun: true, destinatarios: correos });
  }

  try {
    const res = await conTimeout(
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: correos, subject: asunto, html }),
      }),
      RESEND_TIMEOUT_MS,
    );
    if (!res.ok) {
      const detalle = (await res.text()).slice(0, 200);
      return json(502, { error: "Resend rechazó el envío", detalle });
    }
    return json(200, { enviado: true, destinatarios: correos });
  } catch (err) {
    return json(504, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
