// Firmado de URLs de Cloudflare R2 para las Edge Functions. La lógica PURA
// (config, convención de key, endpoint, expiraciones y firmado) vive aquí,
// separada de los handlers, para probarla con `deno test supabase/functions` sin
// red ni credenciales reales — igual que `_shared/pase.ts`.
//
// R2 es "compatible con S3": habla el MISMO protocolo que Amazon S3 (la API y el
// firmado SigV4), pero es un servicio de Cloudflare — no hay cuenta de AWS. Por eso
// `service: "s3"` y `aws4fetch`: "s3" es el nombre del protocolo, no del proveedor.
// Las cuatro variables `R2_*` salen del panel de Cloudflare (bucket + API token +
// account id). Cloudflare no cobra egress, de ahí la elección (ADR-0003).
//
// El binario NUNCA pasa por el servidor: estas funciones solo emiten una URL
// firmada temporal. Sin una URL firmada válida, el objeto en R2 no se puede abrir.

import { AwsClient } from "npm:aws4fetch@1";
import { z } from "npm:zod@4";

export type ConfigR2 = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

// Expiraciones por dirección. La LECTURA la usa el navegador al instante → ventana
// corta, que acota el radio de una URL filtrada. La SUBIDA vive en la cola de disco
// del móvil y puede reintentar sobre una red mala → ventana más amplia, pero acotada.
export const EXPIRACION_LECTURA_SEGUNDOS = 300; // 5 min
export const EXPIRACION_SUBIDA_SEGUNDOS = 900; // 15 min

// Tope del lote de lectura: la galería pide muchas miniaturas de una; se acota el
// fan-out para no firmar sin límite en una sola llamada.
export const TOPE_LOTE_LECTURA = 50;

export const subidaFirmadaSchema = z.object({
  visita_id: z.uuid(),
  // Lo genera el móvil (es el id de la foto en la cola); todavía puede no existir
  // como fila `foto` cuando se pide la URL: el binario y la metadata van por
  // canales distintos y en cualquier orden.
  foto_id: z.uuid(),
});

export const lecturaFirmadaSchema = z.object({
  foto_ids: z.array(z.uuid()).min(1).max(TOPE_LOTE_LECTURA),
});

// Fail-closed: sin las cuatro variables no se puede firmar nada, así que la función
// no arranca — nunca un fallback que abra el bucket.
export function leerConfigR2(env: Record<string, string | undefined>): ConfigR2 {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "Config de R2 incompleta (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / " +
        "R2_SECRET_ACCESS_KEY / R2_BUCKET): la función no arranca (fail-closed)",
    );
  }
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

/** El endpoint S3 de la cuenta de R2. Sin barra final. */
export function endpointR2(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

/** La key del objeto en R2: `tenant/visita/foto-id`. Único dueño de la convención. */
export function construirKeyFoto(ids: {
  tenantId: string;
  visitaId: string;
  fotoId: string;
}): string {
  return `${ids.tenantId}/${ids.visitaId}/${ids.fotoId}`;
}

export function clienteR2(cfg: ConfigR2): AwsClient {
  return new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: "auto",
    service: "s3",
  });
}

async function firmar(
  cliente: AwsClient,
  cfg: ConfigR2,
  key: string,
  metodo: "GET" | "PUT",
  expiraSegundos: number,
): Promise<string> {
  const url = new URL(`${endpointR2(cfg.accountId)}/${cfg.bucket}/${key}`);
  url.searchParams.set("X-Amz-Expires", String(expiraSegundos));
  // `signQuery`: la firma va en el query string, así la URL entera es la credencial
  // (no hace falta cabecera Authorization al usarla).
  const firmada = await cliente.sign(url.toString(), {
    method: metodo,
    aws: { signQuery: true },
  });
  return firmada.url;
}

/** URL PUT prefirmada para subir el binario directo a R2 desde el móvil. */
export function firmarPut(
  cliente: AwsClient,
  cfg: ConfigR2,
  key: string,
): Promise<string> {
  return firmar(cliente, cfg, key, "PUT", EXPIRACION_SUBIDA_SEGUNDOS);
}

/** URL GET prefirmada de expiración corta para servir la foto a la galería/portal. */
export function firmarGet(
  cliente: AwsClient,
  cfg: ConfigR2,
  key: string,
): Promise<string> {
  return firmar(cliente, cfg, key, "GET", EXPIRACION_LECTURA_SEGUNDOS);
}
