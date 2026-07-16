// Entrega del OTP del segundo factor. La invoca GoTrue como hook `send_sms`
// (ADR-0008): Supabase genera y valida el código; nosotros solo lo ENTREGAMOS por
// el canal que corresponda. Devolver {} significa "entrega manejada por el hook".
//
// La rareza que documenta el ADR: el factor es "Teléfono" para Supabase, pero el
// medio normal es el CORREO — no existe un factor "email" nativo. Este hook es
// justo la pieza que traduce uno en otro.
//
// El canal EFECTIVO sale de cruzar dos cosas: lo que el usuario prefiere
// (`profile.canal_2fa`) y lo que la outsourcing permite globalmente
// (`configuracion_plataforma.otp_canales_habilitados`). Si su preferencia no está
// habilitada, cae a correo — nunca se entrega por un canal no permitido.
//
// SEGURIDAD: la puerta es la FIRMA del hook (Standard Webhooks). Sin el secreto la
// función NO arranca: un endpoint que dicta códigos de acceso no puede fallar
// abierto.

import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { z } from "npm:zod@4";

import { clienteServicio, json } from "../_shared/supabase.ts";

const RESEND_TIMEOUT_MS = 10_000;

// Fail-closed: sin el secreto del hook no se puede verificar quién llama.
const HOOK_SECRET = Deno.env.get("SEND_SMS_HOOK_SECRET");
if (!HOOK_SECRET) {
  throw new Error(
    "SEND_SMS_HOOK_SECRET no configurado: la función no arranca (fail-closed)",
  );
}

// La librería espera el secreto en base64, sin el prefijo que usa Supabase.
const PREFIJO = "v1,whsec_";
const webhook = new Webhook(
  HOOK_SECRET.startsWith(PREFIJO)
    ? HOOK_SECRET.slice(PREFIJO.length)
    : HOOK_SECRET,
);

// El modo sin envío real es una decisión EXPLÍCITA de desarrollo, no "no encontré
// la API key": esa es justo la condición de una producción mal aprovisionada, y
// ahí escupir el código en el log mientras se le dice a GoTrue que entregó sería
// un regalo para quien lea los logs.
const DRY_RUN = Deno.env.get("OTP_DRY_RUN") === "true";

const hookSchema = z.object({
  user: z.object({ id: z.guid(), email: z.email().nullish() }),
  // El OTP viene de Supabase y son dígitos (otp_length en config.toml). Acotarlo
  // aquí lo hace inofensivo al interpolarlo en el HTML del correo.
  sms: z.object({
    otp: z.string().regex(/^\d{4,10}$/),
    sms_type: z.string().nullish(),
  }),
});

/** Recorta a n chars: los mensajes de infra pueden arrastrar contenido de más. */
function recorta(s: string, n = 200): string {
  return s.length > n ? s.slice(0, n) : s;
}

/** Race entre la llamada y un deadline; el AbortController corta el fetch de verdad. */
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

  // La firma se calcula sobre el CUERPO CRUDO: hay que leerlo como texto antes de
  // parsearlo.
  const crudo = await req.text();
  let cuerpo: unknown;
  try {
    cuerpo = webhook.verify(crudo, Object.fromEntries(req.headers));
  } catch (err) {
    // Por qué falló (nunca el secreto): sin esto, un rechazo es indistinguible de
    // una firma mal configurada y se depura a ciegas.
    console.error(
      JSON.stringify({
        evento: "firma_hook_invalida",
        detalle: err instanceof Error ? err.message.slice(0, 200) : String(err),
        cabeceras: {
          id: req.headers.get("webhook-id") !== null,
          timestamp: req.headers.get("webhook-timestamp") !== null,
          signature: req.headers.get("webhook-signature") !== null,
        },
      }),
    );
    return json(401, { error: "firma de hook inválida" });
  }

  const parsed = hookSchema.safeParse(cuerpo);
  if (!parsed.success) {
    // Falla VISIBLE: GoTrue se traga el cuerpo de la respuesta, así que sin este
    // log un cambio de forma del payload se depura a ciegas.
    console.error(
      JSON.stringify({
        evento: "payload_hook_invalido",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          code: i.code,
        })),
      }),
    );
    return json(400, {
      error: "payload inválido",
      detalles: parsed.error.issues,
    });
  }
  const { user, sms } = parsed.data;

  const servicio = clienteServicio();

  // Preferencia del usuario y política global, en paralelo.
  const [perfilRes, configRes] = await Promise.all([
    servicio.from("profile").select("canal_2fa").eq("id", user.id).single(),
    servicio
      .from("configuracion_plataforma")
      .select("otp_canales_habilitados")
      .limit(1)
      .single(),
  ]);

  if (perfilRes.error || !perfilRes.data) {
    console.error(
      "[enviar-otp] perfil ilegible",
      recorta(perfilRes.error?.message ?? "sin fila"),
    );
    return json(500, { error: "no se pudo resolver el canal del usuario" });
  }
  if (configRes.error || !configRes.data) {
    console.error(
      "[enviar-otp] configuración ilegible",
      recorta(configRes.error?.message ?? "sin fila"),
    );
    return json(500, { error: "no se pudo leer la política de canales" });
  }

  const habilitados = configRes.data.otp_canales_habilitados;
  const preferido = perfilRes.data.canal_2fa;
  // Su preferencia solo vale si la outsourcing la habilitó; si no, correo — pero
  // solo si el correo TAMBIÉN está habilitado. Nada se entrega por un canal que la
  // política global no permite, ni siquiera el default.
  const canal = habilitados.includes(preferido)
    ? preferido
    : habilitados.includes("correo")
      ? "correo"
      : null;

  if (!canal) {
    console.error("[enviar-otp] ningún canal habilitado para este usuario");
    return json(500, { error: "no hay canal de entrega habilitado" });
  }

  if (canal !== "correo") {
    // SMS y WhatsApp entran en su fase (Twilio). Falla VISIBLE: es preferible que
    // el login se caiga a que el código se entregue por un camino inexistente.
    console.error("[enviar-otp] canal no implementado todavía", canal);
    return json(501, { error: `canal ${canal} aún no implementado` });
  }

  if (!user.email) {
    return json(422, {
      error: "el usuario no tiene correo para recibir el OTP",
    });
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM") ?? "acceso@market-track.local";
  const asunto = "Tu código de acceso · Market Track";
  const html = `<p>Tu código de acceso es:</p>
<p style="font-size:24px;font-weight:700;letter-spacing:3px">${sms.otp}</p>
<p>Vence en unos minutos. Si no intentaste entrar, ignora este correo.</p>`;

  if (!apiKey) {
    // Sin proveedor y sin permiso EXPLÍCITO de dry-run se falla cerrado: una
    // producción a la que no le llegó la API key no puede fingir que entregó
    // (GoTrue daría el challenge por bueno y nadie se enteraría).
    if (!DRY_RUN) {
      console.error(
        JSON.stringify({ evento: "otp_sin_proveedor", user_id: user.id }),
      );
      return json(500, { error: "no hay proveedor de envío configurado" });
    }
    // DRY-RUN (solo desarrollo, con OTP_DRY_RUN=true): el código queda en el log
    // para poder probar el flujo sin mandar correo.
    console.log(
      JSON.stringify({
        evento: "otp_dry_run",
        user_id: user.id,
        sms_type: sms.sms_type ?? null,
        otp: sms.otp,
      }),
    );
    return json(200, {});
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
        body: JSON.stringify({
          from,
          to: [user.email],
          subject: asunto,
          html,
        }),
      },
      RESEND_TIMEOUT_MS,
    );
    if (!res.ok) {
      // Falla VISIBLE: GoTrue solo dirá "error invoking hook", así que el motivo
      // real del rechazo tiene que quedar aquí o se depura a ciegas.
      const detalle = recorta(await res.text());
      console.error(
        JSON.stringify({
          evento: "otp_resend_rechazo",
          status: res.status,
          detalle,
        }),
      );
      return json(502, { error: "Resend rechazó el envío", detalle });
    }
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ evento: "otp_resend_error", detalle: recorta(detalle) }),
    );
    return json(504, { error: detalle });
  }

  // El OTP nunca se loguea cuando sí se envía: solo la traza de la entrega.
  console.log(
    JSON.stringify({
      evento: "otp_enviado",
      user_id: user.id,
      canal,
      sms_type: sms.sms_type ?? null,
    }),
  );
  return json(200, {});
});
