// Guardarraíl de la configuración de entorno: pone el despliegue ROJO cuando un
// proyecto de la nube no tiene cargadas en el vault las claves que leen los
// webhooks (`app.config`).
//
// Por qué existe: el trigger del email de alertas y el barrido de fotos hacen un
// `return` silencioso cuando falta la configuración. Es deliberado —el trigger
// no puede romper el INSERT del sync, y en local no hay a quién llamar—, pero en
// la nube ese silencio es indistinguible de "no había alertas". Staging pasó así
// desde que existe: ni un correo enviado, ni una foto sellada, y el descubrirlo
// fue casualidad semanas después.
//
// Este paso convierte ese silencio en un job rojo con el comando exacto que hay
// que ejecutar. Corre DESPUÉS de aplicar migraciones y funciones: lo que falla
// es la comprobación, no el despliegue.
//
// La lista de claves obligatorias NO está aquí: la tiene `app.config_faltante()`
// (ver la migración `..._config_por_vault.sql`), que es quien puede consultarlas.
// Este script reporta lo que esa función diga, así que añadir una cuarta clave se
// hace en un solo sitio.
//
// Uso:
//   supabase db query --linked --output json \
//     "select app.config_faltante() as faltan, app.config('functions_url') as functions_url" \
//     > config.json
//   node scripts/verificar-config-nube.mjs <project-ref> < config.json

import process from "node:process";
import { pathToFileURL } from "node:url";

// Reutilizado, no copiado: un escapador de anotaciones que existe dos veces se
// arregla una vez y se queda roto en la otra.
import { escaparAnotacion } from "./verificar-migraciones.mjs";

const SUFIJO_FUNCIONES = "/functions/v1";

/**
 * Los problemas de configuración de un entorno de la nube, en frases que digan
 * qué ejecutar. Pura a propósito: la consulta la hace el shim de abajo.
 *
 * @param {object} entrada
 * @param {string[]} entrada.faltan Claves sin cargar, tal cual las devuelve
 *   `app.config_faltante()`.
 * @param {string | null} entrada.functionsUrl Valor de `functions_url`, o null
 *   si no está cargada. No es un secreto: es la URL pública del proyecto.
 * @param {string} entrada.projectRef Ref del proyecto al que se acaba de
 *   desplegar.
 * @returns {string[]} Vacío si todo está bien.
 */
export function revisarConfig({ faltan, functionsUrl, projectRef }) {
  const problemas = [];

  for (const clave of [...faltan].sort()) {
    problemas.push(
      `La clave «${clave}» no está cargada en el vault de este proyecto, así ` +
        `que quien la lee es un no-op silencioso. Cárgala con: ` +
        `select vault.create_secret('<valor>', '${clave}', '<para qué es>');`,
    );
  }

  // El resto solo se puede juzgar si hay valor que juzgar; si no lo hay, ya lo
  // ha dicho el bucle de arriba y repetirlo solo haría ruido.
  if (functionsUrl === null || functionsUrl === "") return problemas;

  if (!functionsUrl.startsWith("https://")) {
    problemas.push(
      `«functions_url» no empieza por https:// (${functionsUrl}). El secreto ` +
        `del webhook viaja en una cabecera de esa petición: sin TLS va en claro.`,
    );
  }

  // Un entorno con la URL de OTRO manda sus alertas a las funciones del otro, y
  // responden 200 — no hay nada que lo delate salvo esto.
  if (!functionsUrl.includes(projectRef)) {
    problemas.push(
      `«functions_url» (${functionsUrl}) no apunta al proyecto que se acaba de ` +
        `desplegar (${projectRef}): la configuración viene copiada de otro ` +
        `entorno y este mandaría sus webhooks al de al lado.`,
    );
  }

  // `app.notificar_alerta_email` concatena `base_url || '/enviar-alerta-email'`:
  // una barra de más da `//enviar-alerta-email` y una 404 que nadie mira, que es
  // exactamente el fallo mudo que este guardarraíl existe para romper.
  if (functionsUrl.endsWith("/")) {
    problemas.push(
      `«functions_url» (${functionsUrl}) acaba en barra. La SQL concatena ` +
        `«${SUFIJO_FUNCIONES}/enviar-alerta-email» detrás, y la doble barra da ` +
        `un 404 asíncrono que no aparece en ningún sitio. Quítasela.`,
    );
  } else if (!functionsUrl.endsWith(SUFIJO_FUNCIONES)) {
    problemas.push(
      `«functions_url» (${functionsUrl}) no acaba en «${SUFIJO_FUNCIONES}». ` +
        `La SQL le pega el nombre de la función detrás, así que la ruta ` +
        `resultante no existiría y el fallo sería mudo.`,
    );
  }

  return problemas;
}

/**
 * El valor de una propiedad, o undefined si lo recibido no es un objeto que la
 * tenga. Existe para que lo que sale de `JSON.parse` se recorra como `unknown`
 * y no como `any`: con `any`, cada acceso de abajo pasaría el type checker sin
 * comprobar nada, que es justo lo contrario de lo que hace esta función.
 *
 * @param {unknown} valor
 * @param {string} nombre
 * @returns {unknown}
 */
function propiedad(valor, nombre) {
  if (typeof valor !== "object" || valor === null || !(nombre in valor)) {
    return undefined;
  }
  return /** @type {Record<string, unknown>} */ (valor)[nombre];
}

/**
 * La fila de la consulta, validada. Lanza —en vez de devolver algo vacío— ante
 * cualquier forma inesperada: un guardarraíl que se salta a sí mismo cuando no
 * entiende su entrada es peor que no tenerlo, porque además da verde.
 *
 * @param {string} texto Salida JSON de `supabase db query --output json`.
 * @returns {{ faltan: string[], functionsUrl: string | null }}
 */
export function leerRespuesta(texto) {
  if (texto.trim() === "") {
    throw new Error(
      "La consulta no devolvió nada. ¿Falló `supabase db query` antes de escribir?",
    );
  }

  /** @type {unknown} */
  let cuerpo;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    throw new Error(
      `La salida de \`supabase db query\` no es JSON:\n${texto.slice(0, 500)}`,
    );
  }

  const filasCrudas = propiedad(cuerpo, "rows");
  if (!Array.isArray(filasCrudas) || filasCrudas.length !== 1) {
    throw new Error(
      `Se esperaba exactamente una fila y llegaron ${Array.isArray(filasCrudas) ? filasCrudas.length : "ninguna"}. ` +
        `¿Se aplicó la migración que crea \`app.config_faltante()\`?`,
    );
  }
  /** @type {unknown[]} */
  const filas = filasCrudas;
  const fila = filas[0];

  const clavesCrudas = propiedad(fila, "faltan");
  if (!Array.isArray(clavesCrudas)) {
    throw new Error(
      "La columna `faltan` no es una lista de nombres de clave; la consulta no es la esperada.",
    );
  }
  /** @type {unknown[]} */
  const claves = clavesCrudas;
  if (!claves.every((clave) => typeof clave === "string")) {
    throw new Error(
      "La columna `faltan` no es una lista de nombres de clave; la consulta no es la esperada.",
    );
  }

  const url = propiedad(fila, "functions_url");
  if (url !== null && url !== undefined && typeof url !== "string") {
    throw new Error("La columna `functions_url` no es texto ni NULL.");
  }

  // El cast se apoya en el `every` de arriba, que es lo que acaba de recorrer
  // cada elemento: sin él, aquí no habría nada que lo respaldase.
  return {
    faltan: /** @type {string[]} */ (claves),
    functionsUrl: url ?? null,
  };
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
      "\n  Falta el ref del proyecto: node scripts/verificar-config-nube.mjs <project-ref>\n",
    );
    process.exit(1);
  }

  const { faltan, functionsUrl } = leerRespuesta(await leerStdin());
  const problemas = revisarConfig({ faltan, functionsUrl, projectRef });

  if (problemas.length === 0) {
    console.log(
      `  Configuración del entorno completa y apuntando a ${projectRef}.`,
    );
    return;
  }

  const anotar = Boolean(process.env.GITHUB_ACTIONS);
  console.error(
    `\n  ${problemas.length} problema(s) en la configuración de ${projectRef}:\n`,
  );
  for (const problema of problemas) {
    console.error(`  · ${problema}\n`);
    if (anotar) console.error(`::error::${escaparAnotacion(problema)}`);
  }
  console.error(`  Ver SETUP.md → "La configuración que vive en el vault".\n`);
  process.exit(1);
}

// Solo al ejecutarlo como comando: los tests importan las funciones puras de
// arriba y no deben quedarse leyendo stdin ni disparar un `process.exit`.
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
