// Emite una URL PUT prefirmada contra R2 para la cola de subida del móvil. El
// binario va DIRECTO del teléfono a R2 con esta URL: nunca pasa por el servidor
// (ADR-0003). Solo su metadata (la fila `foto`) viaja por el sync.
//
// Autoriza como la política de INSERT de `foto`: solo el mercaderista DUEÑO de la
// visita sube sus fotos — no basta con ser del mismo tenant (esa política no da
// escritura al staff). La key sale del tenant LEÍDO de la fila de la visita, nunca
// de un parámetro del cliente: así el llamante no puede inyectar un tenant en la
// ruta del objeto.
//
// La validación del payload vive en esta frontera (Zod). Los schemas y el firmado
// están en `_shared/r2.ts` (probados sin red); aquí solo va el handler.

import { clienteDelLlamante, json } from "../_shared/supabase.ts";
import {
  clienteR2,
  construirKeyFoto,
  EXPIRACION_SUBIDA_SEGUNDOS,
  firmarPut,
  leerConfigR2,
  puedeSubirFoto,
  subidaFirmadaSchema,
} from "../_shared/r2.ts";

// Fail-closed al arrancar: sin la config de R2 no se puede firmar nada.
const CONFIG_R2 = leerConfigR2(Deno.env.toObject());

// Deadline de la consulta: una llamada colgada a Postgres no debe bloquear la
// respuesta ni consumir el presupuesto de la función (Deno `fetch` no trae timeout).
const DB_TIMEOUT_MS = 8_000;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "método no permitido" });

  // Frontera: el cuerpo es de un tercero hasta que Zod lo valida.
  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return json(400, { error: "cuerpo no es JSON válido" });
  }
  const parsed = subidaFirmadaSchema.safeParse(cuerpo);
  if (!parsed.success) {
    return json(400, {
      error: "payload inválido",
      detalles: parsed.error.issues,
    });
  }
  const { visita_id, foto_id } = parsed.data;

  // Autenticación: ¿quién llama? (corre con la RLS del llamante).
  const llamante = clienteDelLlamante(req);
  const { data: auth } = await llamante.auth.getUser();
  if (!auth.user) return json(401, { error: "no autenticado" });

  // La RLS de `visita` solo devuelve filas del tenant del llamante; el dueño se
  // compara aquí, replicando la política de INSERT de `foto`.
  const { data: visita, error } = await llamante
    .from("visita")
    .select("tenant_id, mercaderista_id")
    .eq("id", visita_id)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    .maybeSingle();
  if (error) {
    return json(500, {
      error: "no se pudo leer la visita",
      detalle: error.message.slice(0, 200),
    });
  }
  // Otro tenant (RLS la oculta) o no es el dueño → la MISMA respuesta: no se filtra
  // la existencia entre tenants. La decisión vive en un helper puro y probado.
  if (!puedeSubirFoto(visita, auth.user.id)) {
    return json(403, { error: "sin acceso a la visita" });
  }

  const key = construirKeyFoto({
    tenantId: visita.tenant_id,
    visitaId: visita_id,
    fotoId: foto_id,
  });

  let url: string;
  try {
    url = await firmarPut(clienteR2(CONFIG_R2), CONFIG_R2, key);
  } catch (e) {
    return json(500, {
      error: "no se pudo firmar la subida",
      detalle: (e instanceof Error ? e.message : String(e)).slice(0, 200),
    });
  }

  // Auditoría: quién pidió firmar qué. NUNCA la URL (es la credencial) ni secretos.
  console.log(
    JSON.stringify({
      evento: "foto_subida_firmada",
      caller_id: auth.user.id,
      visita_id,
      foto_id,
    }),
  );

  // `no-store`: la URL firmada no debe quedar en ninguna caché intermedia.
  return json(
    200,
    { url, key, expira_en_segundos: EXPIRACION_SUBIDA_SEGUNDOS },
    { "Cache-Control": "no-store" },
  );
});
