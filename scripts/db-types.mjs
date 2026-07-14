// Regenera los tipos de la base de datos desde el Supabase local.
//
// ⚠️ NO uses `supabase gen types ... > database.types.ts` a pelo. Si Docker está
// apagado, el CLI falla — pero escribe su error en STDOUT, no en stderr:
//
//   {"_tag":"Error","error":{"code":"LegacyPgDeltaSslProbeError", ...}}
//
// Una redirección ingenua machaca la fuente de verdad de los tipos con ese blob,
// todos los workspaces revientan con errores absurdos, y el dev puede commitearlo
// sin enterarse. Por eso aquí se captura la salida, se valida, y solo entonces se
// escribe. Si algo falla, el archivo viejo se queda como estaba.

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import process from "node:process";

const DESTINO = "packages/db/src/database.types.ts";

const gen = spawnSync(
  "pnpm",
  ["exec", "supabase", "gen", "types", "typescript", "--local"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], shell: true },
);

if (gen.status !== 0) {
  console.error(
    `\n  No se pudieron generar los tipos.\n` +
      `  ¿Está levantado el Supabase local?  →  pnpm db:start\n\n` +
      `  ${DESTINO} NO se ha tocado.\n`,
  );
  process.exit(1);
}

const salida = gen.stdout;

// El generador siempre abre con el tipo Json. Si no está, lo que llegó no son
// tipos: es un error disfrazado de salida normal.
if (!salida.startsWith("export type Json")) {
  console.error(
    `\n  La salida del generador no parece TypeScript — probablemente sea un error.\n` +
      `  Primeros 200 caracteres:\n\n  ${salida.slice(0, 200)}\n\n` +
      `  ${DESTINO} NO se ha tocado.\n`,
  );
  process.exit(1);
}

writeFileSync(DESTINO, salida);
console.log(`  ✓ Tipos regenerados en ${DESTINO}`);
