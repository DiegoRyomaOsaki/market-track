// Guardarraíl de `supabase/migrations`: caza las trampas que, si no, solo se
// descubren al desplegar — cuando ya están mergeadas y el arreglo es peor.
//
// Las tres han pasado de verdad en este repositorio:
//
//   1. NOMBRE INVÁLIDO. El CLI de Supabase SALTA en silencio cualquier `.sql`
//      cuyo nombre no sea `<14 dígitos>_nombre.sql` ("Skipping migration ...").
//      La migración no se aplica nunca y nadie se entera: no hay error, solo una
//      línea de log entre otras cincuenta.
//
//   2. TIMESTAMP DUPLICADO. Dos ramas abiertas el mismo día eligen la misma
//      versión (pasó el 17 ago 2026 con MAR-66 y MAR-119, ambas `20260817100000`).
//      Por separado las dos están bien; al mergear la segunda, la base queda con
//      dos migraciones que dicen ser la misma.
//
//   3. FUERA DE ORDEN. Una rama añade una migración con timestamp ANTERIOR a la
//      última que ya está en la rama base. `db push` se planta con "Found local
//      migration files to be inserted before the last migration on remote" y
//      **deja de aplicar TODAS las siguientes**. Así estuvo el despliegue a
//      staging desde el 14 ago 2026: seis migraciones sin aplicar, incluidas tres
//      de seguridad, sin que nadie mirase el rojo.
//
// El arreglo de las tres es el mismo y es trivial ANTES de mergear (renumerar el
// archivo) e incómodo después: renumerar algo ya aplicado en un entorno reescribe
// una historia que ese entorno ya vivió.
//
// Uso:
//   node scripts/verificar-migraciones.mjs               # nombres y duplicados
//   node scripts/verificar-migraciones.mjs <ref-git>     # + orden contra esa ref

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

const CARPETA = "supabase/migrations";

/** `20260817120000_autenticidad_de_foto.sql` → los 14 dígitos del principio. */
const PATRON = /^(\d{14})_[^/]+\.sql$/;

/**
 * La versión de un archivo de migración, o null si su nombre no la lleva —
 * que es justo el caso que el CLI de Supabase ignora sin quejarse.
 *
 * @param {string} archivo Nombre del archivo, sin ruta.
 * @returns {string | null}
 */
export function versionDe(archivo) {
  const m = PATRON.exec(archivo);
  return m ? /** @type {string} */ (m[1]) : null;
}

/**
 * Los problemas de un conjunto de migraciones, en frases que digan qué hacer.
 * Pura a propósito: aquí no se lee ni el disco ni git, así que se puede probar.
 *
 * @param {object} entrada
 * @param {string[]} entrada.locales Nombres de archivo de la rama actual.
 * @param {string[]} entrada.enLaBase Nombres de archivo de la rama base. Vacío
 *   cuando no hay base con la que comparar (un push, o el primer commit): sin
 *   ella, el orden no se puede juzgar y solo se revisan nombres y duplicados.
 * @returns {string[]} Vacío si todo está bien.
 */
export function revisarMigraciones({ locales, enLaBase }) {
  const problemas = [];

  const sqlLocales = locales.filter((a) => a.endsWith(".sql"));

  // 1. Nombres que el CLI saltaría en silencio.
  for (const archivo of sqlLocales
    .filter((a) => versionDe(a) === null)
    .sort()) {
    problemas.push(
      `«${archivo}» no se llama <14 dígitos>_nombre.sql, así que el CLI de ` +
        `Supabase la SALTA sin fallar: no se aplicaría nunca. Renómbrala ` +
        `(o créala con \`supabase migration new <nombre>\`).`,
    );
  }

  // 2. Dos archivos que dicen ser la misma versión.
  /** @type {Map<string, string[]>} */
  const porVersion = new Map();
  for (const archivo of sqlLocales) {
    const version = versionDe(archivo);
    if (version === null) continue;
    porVersion.set(version, [...(porVersion.get(version) ?? []), archivo]);
  }
  for (const [version, archivos] of [...porVersion].sort()) {
    if (archivos.length > 1) {
      problemas.push(
        `La versión ${version} la usan ${archivos.length} migraciones ` +
          `(${archivos.sort().join(", ")}). Renumera todas menos una.`,
      );
    }
  }

  // 3. Añadidas que ordenan antes de lo que ya estaba en la base.
  const versionesBase = enLaBase
    .map(versionDe)
    .filter((v) => /** @type {string | null} */ (v) !== null)
    .sort();
  const ultimaDeLaBase = versionesBase.at(-1);
  if (ultimaDeLaBase !== undefined) {
    const yaEstaban = new Set(enLaBase);
    const anadidas = sqlLocales
      .filter((a) => !yaEstaban.has(a))
      .map((archivo) => ({ archivo, version: versionDe(archivo) }))
      .filter((m) => m.version !== null && m.version <= ultimaDeLaBase)
      .sort((a, b) => a.archivo.localeCompare(b.archivo));

    for (const { archivo, version } of anadidas) {
      problemas.push(
        `«${archivo}» (${version}) ordena antes de ${ultimaDeLaBase}, que ya ` +
          `está en la rama base. \`supabase db push\` se plantaría ahí y ` +
          `dejaría de aplicar TODAS las migraciones siguientes. Renumérala por ` +
          `encima de ${ultimaDeLaBase}.`,
      );
    }
  }

  return problemas;
}

/**
 * Los nombres de archivo de `supabase/migrations` en una ref de git. Devuelve
 * una lista vacía si la ref no existe: sin base no hay orden que comprobar, y
 * eso no es un fallo del guardarraíl.
 *
 * @param {string} ref
 * @returns {string[]}
 */
function migracionesEnLaRef(ref) {
  const git = spawnSync(
    "git",
    ["ls-tree", "-r", "--name-only", ref, "--", CARPETA],
    { encoding: "utf8" },
  );
  if (git.status !== 0) {
    console.warn(
      `  Aviso: no se pudo leer «${ref}» (${(git.stderr ?? "").trim()}).\n` +
        `  Se comprueban nombres y duplicados, pero NO el orden.\n`,
    );
    return [];
  }
  return git.stdout
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => linea.startsWith(`${CARPETA}/`))
    .map((ruta) => ruta.slice(CARPETA.length + 1));
}

function main() {
  const ref = process.argv[2];
  const problemas = revisarMigraciones({
    locales: readdirSync(CARPETA),
    enLaBase: ref ? migracionesEnLaRef(ref) : [],
  });

  if (problemas.length === 0) {
    console.log(
      ref
        ? `  Migraciones en orden y sin duplicados (contra ${ref}).`
        : `  Migraciones con nombres válidos y sin duplicados.`,
    );
    return;
  }

  // La anotación de GitHub pinta el error en la pestaña del PR, no solo en el
  // log del job — que es donde alguien lo vería a tiempo.
  const anotar = Boolean(process.env.GITHUB_ACTIONS);
  console.error(`\n  ${problemas.length} problema(s) en ${CARPETA}:\n`);
  for (const problema of problemas) {
    console.error(`  · ${problema}\n`);
    if (anotar) console.error(`::error file=${CARPETA}::${problema}`);
  }
  console.error(`  Ver SETUP.md → "Migraciones que llegan fuera de orden".\n`);
  process.exit(1);
}

// Solo al ejecutarlo como comando: los tests importan las funciones puras de
// arriba y no deben disparar la lectura del disco ni un `process.exit`.
const ejecutadoDirectamente =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoDirectamente) main();
