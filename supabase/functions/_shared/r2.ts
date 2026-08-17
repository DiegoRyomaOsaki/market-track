// Firmado de URLs de Cloudflare R2 para las Edge Functions. La lógica PURA
// (config, convención de key, endpoint, expiraciones, autorización de subida y
// firmado) vive aquí, separada de los handlers, para probarla con
// `deno test supabase/functions` sin red ni credenciales reales — igual que
// `_shared/pase.ts`.
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
// El HEAD lo hace el propio servidor y al instante: la ventana más corta de todas.
export const EXPIRACION_HEAD_SEGUNDOS = 60;

// Tope del lote de lectura: la galería pide muchas miniaturas de una; se acota el
// fan-out para no firmar sin límite en una sola llamada.
export const TOPE_LOTE_LECTURA = 50;

// Al SERVIR se fuerzan el tipo y la disposición como parámetros de respuesta
// firmados: aunque el objeto almacenado tuviera un MIME ejecutable (image/svg+xml,
// text/html con <script>), R2 lo entrega como imagen en línea, así que abrir la URL
// como documento no ejecuta nada. El bucket es privado y toda lectura pasa por
// `firmarGet`, así que esta es la única superficie de servido — y la que cierra el
// XSS almacenado en origen, sin depender de cómo la pinte cada consumidor.
const SERVIR_COMO_IMAGEN: Record<string, string> = {
  "response-content-type": "image/jpeg",
  "response-content-disposition": 'inline; filename="foto.jpg"',
};

// `z.guid()`, no `z.uuid()`, como en el resto de las Edge Functions. El estricto
// exige los bits de versión del RFC 9562, que Postgres NO impone: su tipo `uuid`
// acepta cualquier hexadecimal con el formato correcto. Estas funciones eran las
// únicas que se habían quedado con el estricto, y rechazaban con un 400 ids que la
// base considera perfectamente válidos — entre ellos todos los del seed, que es
// justo con lo que se prueban.
export const subidaFirmadaSchema = z.object({
  visita_id: z.guid(),
  // Lo genera el móvil (es el id de la foto en la cola); todavía puede no existir
  // como fila `foto` cuando se pide la URL: el binario y la metadata van por
  // canales distintos y en cualquier orden.
  foto_id: z.guid(),
});

export const lecturaFirmadaSchema = z.object({
  foto_ids: z.array(z.guid()).min(1).max(TOPE_LOTE_LECTURA),
});

// Fail-closed: sin las cuatro variables no se puede firmar nada, así que la función
// no arranca — nunca un fallback que abra el bucket.
export function leerConfigR2(
  env: Record<string, string | undefined>,
): ConfigR2 {
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

export type VisitaAutz = { mercaderista_id: string } | null;

/**
 * ¿Puede este llamante subir una foto a esta visita? Solo el mercaderista DUEÑO —
 * replica la política de INSERT de `foto` (que no da escritura al staff). La visita
 * ya llega LEÍDA bajo la RLS del llamante, así que `null` significa "de otro tenant
 * u oculta": se colapsa con "no es el dueño" en la misma respuesta, sin filtrar
 * existencia entre tenants.
 */
export function puedeSubirFoto(visita: VisitaAutz, callerId: string): boolean {
  return visita !== null && visita.mercaderista_id === callerId;
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
  metodo: "GET" | "PUT" | "HEAD",
  expiraSegundos: number,
  overrides?: Record<string, string>,
): Promise<string> {
  const url = new URL(`${endpointR2(cfg.accountId)}/${cfg.bucket}/${key}`);
  url.searchParams.set("X-Amz-Expires", String(expiraSegundos));
  // Los overrides (p. ej. `response-content-type`) van al query ANTES de firmar,
  // así quedan dentro de la firma y R2 los exige al servir.
  for (const [k, v] of Object.entries(overrides ?? {})) {
    url.searchParams.set(k, v);
  }
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

/** URL GET prefirmada de expiración corta para servir la foto a la galería/portal,
 * forzando un tipo de imagen en línea (ver `SERVIR_COMO_IMAGEN`). */
export function firmarGet(
  cliente: AwsClient,
  cfg: ConfigR2,
  key: string,
): Promise<string> {
  return firmar(
    cliente,
    cfg,
    key,
    "GET",
    EXPIRACION_LECTURA_SEGUNDOS,
    SERVIR_COMO_IMAGEN,
  );
}

/** URL HEAD prefirmada: pregunta si el objeto EXISTE sin descargar el binario.
 * Sin los overrides de servido: aquí no se sirve nada. El verbo va dentro de la
 * firma (SigV4), así que no vale reutilizar la de GET. */
export function firmarHead(
  cliente: AwsClient,
  cfg: ConfigR2,
  key: string,
): Promise<string> {
  return firmar(cliente, cfg, key, "HEAD", EXPIRACION_HEAD_SEGUNDOS);
}

export type CabezaDeObjeto = { estado: number; bytes: number | null };

/** `Content-Length` como entero no negativo, o null si R2 no lo informó o no es
 * un número. Nunca se inventa un tamaño. */
export function bytesDeContentLength(valor: string | null): number | null {
  if (valor === null) return null;
  if (!/^\d+$/.test(valor.trim())) return null;
  const n = Number(valor);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * El HEAD real contra R2, con plazo. Devuelve el estado HTTP y el tamaño; lanza
 * ante red caída o plazo agotado — el llamante lo mapea a "reintentar", nunca a
 * "no existe" (una caída de R2 no es evidencia de nada).
 */
export async function cabezaDeObjeto(
  cliente: AwsClient,
  cfg: ConfigR2,
  key: string,
  plazoMs: number,
): Promise<CabezaDeObjeto> {
  const url = await firmarHead(cliente, cfg, key);
  const respuesta = await fetch(url, {
    method: "HEAD",
    signal: AbortSignal.timeout(plazoMs),
  });
  return {
    estado: respuesta.status,
    bytes: bytesDeContentLength(respuesta.headers.get("content-length")),
  };
}
