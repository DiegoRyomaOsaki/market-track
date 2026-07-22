import { z } from "zod";

// Cómo entran los secretos al sistema, y por qué un secreto que falta tiene que
// romper el ARRANQUE y no la producción.
//
// El módulo NO lee `process.env` por su cuenta: lo recibe. Así se puede testear
// sin ensuciar el entorno del proceso, y este paquete no arrastra los tipos de
// Node a la app móvil, que también lo importa.
//
//   import { parseEnvServidor } from "@market-track/shared";
//   export const env = parseEnvServidor(process.env);   // ← en la app, al cargar

/**
 * Secretos que NUNCA pueden llegar al cliente.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` es el peor de todos: **salta RLS por diseño**. Con
 * ella, cualquiera lee los datos de TODOS los clientes — que es exactamente lo
 * que el contrato promete que no puede pasar.
 */
const SECRETOS_SERVER_ONLY = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "RESEND_API_KEY",
  "POWERSYNC_PRIVATE_KEY",
] as const;

/**
 * Todo lo que lleve estos prefijos **se empaqueta en el bundle del cliente**.
 * Next.js y Expo los incrustan en tiempo de build: una vez publicado, el valor
 * está en el teléfono de cualquiera que descargue el APK.
 */
const PREFIJOS_PUBLICOS = ["NEXT_PUBLIC_", "EXPO_PUBLIC_"] as const;

/**
 * El guardarraíl que da sentido a este módulo.
 *
 * Un `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` no da error en ningún sitio: la app
 * arranca, los tests pasan, el deploy sale verde — y la clave que salta RLS viaja
 * dentro del JavaScript que sirve el navegador. Nadie se entera hasta que alguien
 * abre las DevTools.
 *
 * Por eso esto **lanza**, no avisa.
 */
export function assertSinSecretosExpuestos(
  raw: Record<string, string | undefined>,
): void {
  const expuestos: string[] = [];

  for (const clave of Object.keys(raw)) {
    const prefijo = PREFIJOS_PUBLICOS.find((p) => clave.startsWith(p));
    if (!prefijo) continue;

    const sinPrefijo = clave.slice(prefijo.length);
    const esSecreto = SECRETOS_SERVER_ONLY.some(
      (s) => sinPrefijo === s || sinPrefijo.includes(s),
    );
    if (esSecreto) expuestos.push(clave);
  }

  if (expuestos.length > 0) {
    throw new Error(
      `Secretos de servidor bajo un prefijo PÚBLICO: ${expuestos.join(", ")}.\n` +
        `Todo lo que empieza por ${PREFIJOS_PUBLICOS.join(" o ")} se empaqueta en el bundle del cliente.\n` +
        `La service_role key salta RLS: expuesta, cualquiera lee los datos de todos los clientes.`,
    );
  }
}

/** Lo que SÍ puede viajar al cliente. La anon key es pública por diseño: RLS la contiene. */
export const envPublicoSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SENTRY_DSN: z.url().optional(),
  /**
   * El archivo PMTiles del mapa base (ADR-0009). Es público: un mapa base de
   * OpenStreetMap, no un secreto.
   *
   * Opcional porque **el móvil no lleva mapa**: su geocerca es un cálculo de
   * distancia. Exigirla obligaría a la app del mercaderista a declarar una URL
   * que nunca usa. Quien sí la necesita (la web) muestra un error explícito si
   * falta, en vez de un mapa gris sin explicación.
   *
   * Admite URL absoluta (el bucket de R2 en producción) o una ruta del propio
   * sitio (`/tiles/lima.pmtiles` en desarrollo). Lo que NO admite es `//host`:
   * eso es una URL protocolo-relativa a otro dominio disfrazada de ruta.
   */
  TILES_URL: z
    .union([
      z.url(),
      z.string().regex(/^\/[^/]/, "Ruta del sitio (/tiles/…) o URL absoluta"),
    ])
    .optional(),
  /**
   * El endpoint del servicio PowerSync (ADR-0001). Es público: solo el endpoint;
   * quién ve qué lo deciden las sync rules validando el JWT.
   *
   * Opcional porque solo el móvil sincroniza — la web no. Exigirla obligaría a la
   * web a declarar una URL que nunca usa.
   */
  POWERSYNC_URL: z.url().optional(),
});

/**
 * Lo que solo existe en el servidor.
 *
 * Sin valores por defecto, y es deliberado: un fallback para un secreto es un
 * bypass de autenticación esperando a llegar a producción. Si falta, se rompe el
 * arranque — que es el único momento en que romperse sale barato.
 */
export const envServidorSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
});

export type EnvPublico = z.infer<typeof envPublicoSchema>;
export type EnvServidor = z.infer<typeof envServidorSchema>;

/** Mensaje de error que dice QUÉ falta, no "invalid input". */
function explota(error: z.ZodError, ambito: string): never {
  const detalle = error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(
    `Variables de entorno inválidas (${ambito}):\n${detalle}\n\n` +
      `Copia .env.example y rellénalas. No hay valores por defecto para los secretos: ` +
      `un fallback que llega a producción es un bypass de auth silencioso.`,
  );
}

export function parseEnvPublico(
  raw: Record<string, string | undefined>,
): EnvPublico {
  assertSinSecretosExpuestos(raw);
  const r = envPublicoSchema.safeParse(raw);
  if (!r.success) explota(r.error, "cliente");
  return r.data;
}

export function parseEnvServidor(
  raw: Record<string, string | undefined>,
): EnvServidor {
  assertSinSecretosExpuestos(raw);
  const r = envServidorSchema.safeParse(raw);
  if (!r.success) explota(r.error, "servidor");
  return r.data;
}
