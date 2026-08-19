// Guardarraíl de los secretos de las Edge Functions: pone el despliegue ROJO
// cuando a un proyecto de la nube le falta uno que alguna función necesita para
// arrancar.
//
// Por qué existe: varias funciones son FAIL-CLOSED a propósito —sin su secreto
// lanzan al cargar el módulo y no arrancan—, que es la postura correcta para un
// endpoint cuya única puerta es ese secreto. Lo que no es correcto es enterarse
// por casualidad. En un solo día aparecieron dos casos así en staging: el motor
// de alertas y el barrido de fotos llevaban desde que existían sin ejecutarse, y
// `enviar-otp` estaba muerto, lo que dejaba a CUALQUIERA sin poder completar el
// 2FA — y como el gate `aal2` vive en la RLS, sin 2FA no se ve ni una fila.
//
// Es el hermano de `verificar-config-nube.mjs`. Aquel mira la configuración que
// vive en la BASE (vault); este, la que vive en la PLATAFORMA (`supabase secrets
// set`). Son dos canales distintos con el mismo modo de fallo.
//
// Nunca viaja un valor: `supabase secrets list` devuelve nombres y digests.
//
// Uso:
//   supabase secrets list --project-ref <REF> -o json > secretos.json
//   node scripts/verificar-secretos-funciones.mjs <project-ref> < secretos.json

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { escaparAnotacion } from "./verificar-migraciones.mjs";

const CARPETA_FUNCIONES = "supabase/functions";

/**
 * Sin estos, alguna función LANZA al cargar y no atiende ni una petición. El
 * motivo de cada uno está aquí porque es lo que permite decidir, cuando aparezca
 * el siguiente, si va en esta lista o en la de abajo.
 */
export const OBLIGATORIOS = {
  ALERTA_WEBHOOK_SECRET:
    "`enviar-alerta-email` no arranca sin él: es la única puerta de un endpoint que revela correos y manda email.",
  FOTO_VERIFICACION_SECRET:
    "`fotos-verificar` no arranca sin él, y sin barrido `foto.verificada_at` no se sella nunca.",
  PASE_HASH_SECRET:
    "`emitir-pase` y `canjear-pase` no arrancan sin él: es el HMAC del código del pase.",
  SEND_SMS_HOOK_SECRET:
    "`enviar-otp` no arranca sin él. Sin OTP nadie completa el 2FA, y como el gate `aal2` vive en la RLS, una sesión que no llega a aal2 no ve ni una fila.",
  R2_ACCOUNT_ID:
    "`leerConfigR2` exige las cuatro R2_* o lanza (fail-closed): sin ellas no arranca ninguna función de fotos.",
  R2_ACCESS_KEY_ID:
    "`leerConfigR2` exige las cuatro R2_* o lanza (fail-closed): sin ellas no arranca ninguna función de fotos.",
  R2_SECRET_ACCESS_KEY:
    "`leerConfigR2` exige las cuatro R2_* o lanza (fail-closed): sin ellas no arranca ninguna función de fotos.",
  R2_BUCKET:
    "`leerConfigR2` exige las cuatro R2_* o lanza (fail-closed): sin ellas no arranca ninguna función de fotos.",
};

/** Con estos la función arranca igual; su ausencia degrada, no rompe. */
export const OPCIONALES = {
  RESEND_API_KEY: "sin ella el envío corre en dry-run en vez de mandar.",
  RESEND_FROM: "tiene valor por defecto.",
  OTP_DRY_RUN: "modo de desarrollo, explícito a propósito.",
};

/** Los pone Supabase en cada función; cargarlos a mano sería una copia que mantener. */
export const INYECTADOS = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
  "SUPABASE_JWKS",
  "SUPABASE_PUBLISHABLE_KEYS",
  "SUPABASE_SECRET_KEYS",
];

/**
 * Los problemas de aprovisionamiento de un entorno, en frases que digan qué
 * ejecutar. Pura a propósito: ni lee disco ni habla con la nube.
 *
 * @param {object} entrada
 * @param {string[]} entrada.presentes Nombres cargados en el proyecto.
 * @param {string[]} entrada.usados Nombres que el código lee con `Deno.env.get`.
 * @param {string} entrada.projectRef Proyecto al que se acaba de desplegar.
 * @returns {string[]} Vacío si todo está bien.
 */
export function revisarSecretos({ presentes, usados, projectRef }) {
  const problemas = [];
  const cargados = new Set(presentes);

  // Comparador explícito: el `sort()` por defecto compararía los pares
  // [nombre, motivo] convertidos a texto. Aquí funcionaría por casualidad —los
  // nombres van delante de la coma y no chocan—, y el guardarraíl hermano de
  // migraciones ya dejó escrito por qué eso no basta como criterio.
  const obligatorios = Object.entries(OBLIGATORIOS).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  for (const [nombre, motivo] of obligatorios) {
    if (cargados.has(nombre)) continue;
    problemas.push(
      `Falta el secreto «${nombre}» en ${projectRef}. ${motivo} ` +
        `Cárgalo con: supabase secrets set --project-ref ${projectRef} ${nombre}='<valor>'`,
    );
  }

  // Anti-deriva, que es la razón por la que este guardarraíl existe: la lista de
  // arriba se escribió a mano y el código sigue creciendo. Un secreto nuevo que
  // nadie clasifique aquí volvería a descubrirse por casualidad, que es
  // exactamente lo que pasó dos veces.
  const clasificados = new Set([
    ...Object.keys(OBLIGATORIOS),
    ...Object.keys(OPCIONALES),
    ...INYECTADOS,
  ]);
  for (const nombre of [...new Set(usados)].sort()) {
    if (clasificados.has(nombre)) continue;
    problemas.push(
      `El código lee «${nombre}» con Deno.env.get y esta comprobación no sabe ` +
        `si es obligatorio. Clasifícalo en OBLIGATORIOS u OPCIONALES de ` +
        `scripts/verificar-secretos-funciones.mjs.`,
    );
  }

  return problemas;
}

/**
 * Los nombres que el código de las Edge Functions lee del entorno.
 *
 * Solo ve los `Deno.env.get("LITERAL")`. `leerConfigR2` usa `Deno.env.toObject()`
 * y sus cuatro `R2_*` no aparecen por aquí — por eso están declaradas a mano
 * arriba. Es una limitación conocida, no un olvido: el escaneo existe para
 * cazar lo que se AÑADA, y lo que se añade se escribe con `Deno.env.get`.
 *
 * @param {string} carpeta
 * @returns {string[]}
 */
export function secretosUsadosEnElCodigo(carpeta = CARPETA_FUNCIONES) {
  /** @type {string[]} */
  const nombres = [];
  const patron = /Deno\.env\.get\(\s*["'`]([A-Z0-9_]+)["'`]\s*\)/g;

  /** @param {string} dir */
  function recorrer(dir) {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, entrada.name);
      if (entrada.isDirectory()) {
        recorrer(ruta);
        continue;
      }
      if (!entrada.name.endsWith(".ts") || entrada.name.endsWith(".test.ts")) {
        continue;
      }
      const contenido = readFileSync(ruta, "utf8");
      for (const m of contenido.matchAll(patron)) nombres.push(m[1] ?? "");
    }
  }

  recorrer(carpeta);
  return nombres.filter((n) => n !== "");
}

/**
 * Los nombres de secreto de la salida de `supabase secrets list -o json`. Lanza
 * ante cualquier forma inesperada: un guardarraíl que no entiende su entrada y
 * aun así da verde es peor que no tenerlo.
 *
 * @param {string} texto
 * @returns {string[]}
 */
export function leerSecretos(texto) {
  if (texto.trim() === "") {
    throw new Error(
      "`supabase secrets list` no devolvió nada. ¿Falló antes de escribir?",
    );
  }

  /** @type {unknown} */
  let cuerpo;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    throw new Error(
      `La salida de \`supabase secrets list\` no es JSON.\n  Respuesta recibida: ${resumirPayload(texto)}`,
    );
  }

  // El CLI tiene DOS formas según cómo se le pida: `-o json` devuelve un array
  // pelado, y la salida por defecto lo envuelve en `{"secrets": [...]}`. Se
  // aceptan las dos porque las dos son legítimas y la diferencia no se ve hasta
  // que el despliegue se pone rojo.
  const lista = Array.isArray(cuerpo)
    ? cuerpo
    : typeof cuerpo === "object" && cuerpo !== null && "secrets" in cuerpo
      ? /** @type {Record<string, unknown>} */ (cuerpo).secrets
      : undefined;
  if (!Array.isArray(lista)) {
    throw new Error(
      `La salida no es ni una lista de secretos ni un objeto con \`secrets\`.\n  Respuesta recibida: ${resumirPayload(texto)}`,
    );
  }

  /** @type {unknown[]} */
  const filas = lista;
  return filas.map((fila) => {
    const nombre =
      typeof fila === "object" && fila !== null && "name" in fila
        ? /** @type {Record<string, unknown>} */ (fila).name
        : undefined;
    if (typeof nombre !== "string") {
      throw new Error("Una entrada de `secrets` no trae `name` de texto.");
    }
    return nombre;
  });
}

/**
 * La respuesta cruda, lista para meterla en un mensaje de error.
 *
 * Enseñarla es lo que permite arreglar un rojo sin gastar otro despliegue — pero
 * `secrets list` trae un `value` por secreto que es su digest SHA-256, y esto va
 * al log de un runner. El digest de un secreto de alta entropía no es reversible,
 * así que no es una fuga grave; tampoco hay motivo para publicarlo. Se tacha.
 *
 * @param {string} texto
 * @returns {string}
 */
export function resumirPayload(texto) {
  const sinDigests = texto.replace(
    /("value"\s*:\s*)"[^"]*"/g,
    '$1"<digest tachado>"',
  );
  return sinDigests.length > 400 ? `${sinDigests.slice(0, 400)}…` : sinDigests;
}

/** Todo el stdin como texto. */
async function leerStdin() {
  const trozos = [];
  for await (const trozo of process.stdin) trozos.push(trozo);
  return Buffer.concat(trozos).toString("utf8");
}

async function main() {
  const projectRef = process.argv[2];
  if (!projectRef) {
    console.error(
      "\n  Falta el ref: node scripts/verificar-secretos-funciones.mjs <project-ref>\n",
    );
    process.exit(1);
  }

  const problemas = revisarSecretos({
    presentes: leerSecretos(await leerStdin()),
    usados: secretosUsadosEnElCodigo(),
    projectRef,
  });

  if (problemas.length === 0) {
    console.log(`  Secretos de las Edge Functions completos en ${projectRef}.`);
    return;
  }

  const anotar = Boolean(process.env.GITHUB_ACTIONS);
  console.error(`\n  ${problemas.length} problema(s) en ${projectRef}:\n`);
  for (const problema of problemas) {
    console.error(`  · ${problema}\n`);
    if (anotar) console.error(`::error::${escaparAnotacion(problema)}`);
  }
  console.error(`  Ver SETUP.md → "Desplegar a la nube".\n`);
  process.exit(1);
}

const ejecutadoDirectamente =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoDirectamente) {
  main().catch((/** @type {unknown} */ error) => {
    console.error(
      `\n  ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
