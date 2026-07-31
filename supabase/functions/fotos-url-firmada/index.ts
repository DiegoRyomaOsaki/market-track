// Emite URLs GET prefirmadas de expiración corta para la galería/portal: las fotos
// NO son públicas (ADR-0003). Acepta un lote ACOTADO de foto_ids y devuelve solo
// las que el llamante puede ver por RLS — las que no, se omiten del mapa (la
// omisión es la señal de "no encontrada / sin acceso", sin sondear existencia entre
// tenants). El consumidor (galería) trata una key ausente como no-encontrada, no
// como error.
//
// Reconstruye la key desde la propia fila (`tenant/visita/foto-id`): NUNCA firma el
// texto libre de `url_r2` — el único dueño de la convención de key es el builder.
//
// Corre con la RLS del llamante (nunca `service_role`): el acceso a foto es una
// lectura por tenant/rol ya modelada en RLS, así que la base es la autoridad.

import { clienteDelLlamante, json } from "../_shared/supabase.ts";
import {
  clienteR2,
  construirKeyFoto,
  firmarGet,
  leerConfigR2,
  lecturaFirmadaSchema,
} from "../_shared/r2.ts";

// Fail-closed al arrancar: sin la config de R2 no se puede firmar nada.
const CONFIG_R2 = leerConfigR2(Deno.env.toObject());

const DB_TIMEOUT_MS = 8_000;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "método no permitido" });

  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return json(400, { error: "cuerpo no es JSON válido" });
  }
  const parsed = lecturaFirmadaSchema.safeParse(cuerpo);
  if (!parsed.success) {
    return json(400, {
      error: "payload inválido",
      detalles: parsed.error.issues,
    });
  }
  const { foto_ids } = parsed.data;

  const llamante = clienteDelLlamante(req);
  const { data: auth } = await llamante.auth.getUser();
  if (!auth.user) return json(401, { error: "no autenticado" });

  // La RLS de `foto` devuelve solo las filas que el llamante puede ver (su tenant o
  // staff); las que no vuelvan, se omiten del resultado.
  const { data: fotos, error } = await llamante
    .from("foto")
    .select("id, tenant_id, visita_id")
    .in("id", foto_ids)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (error) {
    return json(500, {
      error: "no se pudieron leer las fotos",
      detalle: error.message.slice(0, 200),
    });
  }

  const cliente = clienteR2(CONFIG_R2);
  const urls: Record<string, string> = {};
  try {
    // Fan-out acotado (≤ TOPE_LOTE_LECTURA) y el firmado es cripto local (sin red):
    // el bucle secuencial basta y mantiene el orden claro.
    for (const f of fotos ?? []) {
      const key = construirKeyFoto({
        tenantId: f.tenant_id,
        visitaId: f.visita_id,
        fotoId: f.id,
      });
      urls[f.id] = await firmarGet(cliente, CONFIG_R2, key);
    }
  } catch (e) {
    return json(500, {
      error: "no se pudieron firmar las lecturas",
      detalle: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
  }

  console.log(
    JSON.stringify({
      evento: "foto_lectura_firmada",
      caller_id: auth.user.id,
      pedidas: foto_ids.length,
      firmadas: Object.keys(urls).length,
    }),
  );

  return json(200, { urls }, { "Cache-Control": "no-store" });
});
