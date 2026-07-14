// Puesta a punto de un equipo nuevo. Idempotente: correrlo dos veces no rompe nada.
//
//   pnpm bootstrap   → instala, configura los hooks y audita las herramientas
//   pnpm install     → dispara `prepare`, que configura los hooks (nada más)
//
// Este script NO toca la configuración global de Claude Code (~/.claude.json).
// Los pasos que la requieren se imprimen para que los hagas tú: un script de un
// repositorio no debería reescribir la config global de tu máquina a tus
// espaldas, y la autenticación OAuth es interactiva de todos modos.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

/** @type {[number, number]} */
const NODE_MINIMO = [22, 14];

const soloHooks = process.argv.includes("--hooks-only");

/** @param {string} m */
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
/** @param {string} m */
const falta = (m) => console.log(`  \x1b[33m✗\x1b[0m ${m}`);
/** @param {string} m */
const paso = (m) => console.log(`  \x1b[36m→\x1b[0m ${m}`);

/**
 * ¿Está el ejecutable en el PATH?
 * @param {string} cmd
 * @returns {boolean}
 */
function existeComando(cmd) {
  const quien = process.platform === "win32" ? "where" : "which";
  return spawnSync(quien, [cmd], { stdio: "ignore" }).status === 0;
}

/** Los hooks versionados no se activan solos: Git ignora .githooks por defecto. */
function configurarHooks() {
  if (!existsSync(".git")) {
    falta("no es un clon de git — me salto los hooks");
    return;
  }
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
    stdio: "ignore",
  });
  ok(
    "hooks activados (.githooks/pre-push rechaza el push directo a main y dev)",
  );
}

if (soloHooks) {
  configurarHooks();
  process.exit(0);
}

console.log("\nMarket Track — puesta a punto\n");

// --- Node
const [mayor = 0, menor = 0] = process.versions.node.split(".").map(Number);
const [MAYOR_MIN, MENOR_MIN] = NODE_MINIMO;
const nodeSirve =
  mayor > MAYOR_MIN || (mayor === MAYOR_MIN && menor >= MENOR_MIN);
if (nodeSirve) {
  ok(`Node ${process.versions.node}`);
} else {
  falta(
    `Node ${process.versions.node} — se necesita >= ${NODE_MINIMO.join(".")}`,
  );
}

// --- Dependencias. pnpm se autodescarga con la versión fijada en packageManager,
// así que no hace falta instalarlo a mano.
console.log("\nInstalando dependencias…");
const instalacion = spawnSync("pnpm", ["install"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (instalacion.status !== 0) {
  console.error("\n  Falló `pnpm install`. Revisa el error de arriba.\n");
  process.exit(1);
}
// Los hooks NO se configuran aquí: `pnpm install` acaba de disparar el script
// `prepare`, que es quien lo hace. Hacerlo también aquí solo duplicaría el aviso.

// --- Herramientas externas
const herramientas = [
  {
    cmd: "gh",
    desc: "GitHub CLI — necesario para abrir PRs",
    url: "https://cli.github.com",
  },
  {
    cmd: "docker",
    desc: "Docker — lo necesita `supabase start` (base de datos local)",
    url: "https://docs.docker.com/desktop/",
  },
];
console.log("");
for (const { cmd, desc, url } of herramientas) {
  if (existeComando(cmd)) ok(desc);
  else falta(`${desc}\n      instalar: ${url}`);
}

// --- Lo que no puedo hacer por ti
console.log("\n\x1b[1mPasos manuales (no se pueden automatizar):\x1b[0m\n");
paso(
  "Autenticar Linear:  \x1b[1m/mcp\x1b[0m → linear-mt → Authenticate\n" +
    "      El servidor ya está declarado en .mcp.json; falta el OAuth.\n" +
    "      \x1b[33mCierra sesión en linear.app antes\x1b[0m (o usa incógnito): si no, el\n" +
    "      OAuth reusa la sesión abierta y acabas en el workspace equivocado.\n" +
    "      La cuenta correcta es diegopuerto0628@gmail.com.",
);
paso(
  "Desactivar el conector de Linear equivocado:  \x1b[1m/mcp\x1b[0m → claude.ai Linear → disable\n" +
    "      Apunta a otra cuenta (Scrybe) y \x1b[33mno ve Market-Track\x1b[0m. Si se queda\n" +
    "      activo, un ticket puede acabar en el workspace equivocado.",
);
paso("Leer \x1b[1mSETUP.md\x1b[0m para el detalle y las cuentas cloud.");

console.log(
  "\nListo. Comprueba con: \x1b[1mpnpm turbo run lint typecheck\x1b[0m\n",
);
