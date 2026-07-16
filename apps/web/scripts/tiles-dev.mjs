// Baja el mapa base de desarrollo: un extracto de Lima en PMTiles (ADR-0009).
//
// Lee el planeta REMOTO (~120 GB) por HTTP range requests y solo se descarga el
// trozo pedido: Lima z0–14 son ~9,4 MiB y 32 peticiones. En producción esto no
// corre — ahí el archivo (Perú entero) vive en R2, y `TILES_URL` lo apunta.
//
// Va en Node y no en un script de shell a propósito: `spawn` pasa los argumentos
// tal cual, sin que Git Bash reescriba `/salida` a `C:/Program Files/Git/salida`.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const DESTINO_DIR = resolve(AQUI, "..", "public", "tiles");
const DESTINO = resolve(DESTINO_DIR, "lima.pmtiles");

// El build del planeta es diario; se fija el mismo que se midió al decidir para
// que dos desarrolladores no acaben con mapas distintos sin saber por qué.
const PLANETA = "https://build.protomaps.com/20260715.pmtiles";
const BBOX_LIMA = "-77.20,-12.35,-76.75,-11.75";
const ZOOM_MAX = "14";
const IMAGEN = "protomaps/go-pmtiles:latest";

if (existsSync(DESTINO)) {
  const mb = (statSync(DESTINO).size / 1024 / 1024).toFixed(1);
  console.log(`Ya está: ${DESTINO} (${mb} MiB). Bórralo para rehacerlo.`);
  process.exit(0);
}

mkdirSync(DESTINO_DIR, { recursive: true });
console.log(`Extrayendo Lima del planeta remoto (~9,4 MiB)…`);

const r = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "-v",
    `${DESTINO_DIR}:/salida`,
    IMAGEN,
    "extract",
    PLANETA,
    "/salida/lima.pmtiles",
    `--bbox=${BBOX_LIMA}`,
    `--maxzoom=${ZOOM_MAX}`,
  ],
  { stdio: "inherit" },
);

if (r.error?.code === "ENOENT") {
  console.error(
    "Hace falta Docker para bajar los tiles. Arranca Docker Desktop y reintenta.",
  );
  process.exit(1);
}
if (r.status !== 0) {
  console.error("No se pudo extraer el mapa base.");
  process.exit(r.status ?? 1);
}

const mb = (statSync(DESTINO).size / 1024 / 1024).toFixed(1);
console.log(
  `Listo: ${DESTINO} (${mb} MiB). Apunta NEXT_PUBLIC_TILES_URL a /tiles/lima.pmtiles`,
);
