import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { Client } from "pg";

import { PG, POWERSYNC_URL, SUPABASE_URL } from "./ayudas";

// Los prerrequisitos del harness, comprobados ANTES de que los tests mientan.
//
// Sin esto, una replicación muerta se ve exactamente igual que un fallo de
// aislamiento: `waitForFirstSync` agota su espera y el test dice «esperaba más de
// 0 filas». O sea que el harness acusa a las sync rules de un problema que está
// tres capas más abajo — y quien lo lee se va a buscar el fallo donde no está.
//
// Cada comprobación va en el orden en que las cosas dependen unas de otras, y
// cada una dice qué hacer. Es lo único que hace creíble un verde: un harness que
// no puede distinguir «no bajó nada porque la regla es correcta» de «no bajó nada
// porque no hay replicación» no prueba ninguna de las dos cosas.

/** El rol y la contraseña que declara `config/postgres-setup.sql`. */
const ROL = "powersync_role";
const CLAVE_ROL = "powersync_local";

const SETUP = fileURLToPath(
  new URL("../config/postgres-setup.sql", import.meta.url),
);

/**
 * Aplica `postgres-setup.sql`: rol de replicación, grants y publicación.
 *
 * No es un paso de «una vez al clonar». `supabase db reset` reconstruye la base y
 * se lleva la publicación por delante, así que hay que reaplicarlo DESPUÉS DE
 * CADA RESET. Hasta ahora no lo corría nadie —ni un script, ni el bootstrap, ni
 * una migración—, y por eso el harness no podía pasar en una máquina nueva.
 */
export async function prepararPostgres(): Promise<void> {
  const sql = await readFile(SETUP, "utf8");
  const c = new Client({ connectionString: PG });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

/** Conecta COMO el rol de replicación, que es lo que hace PowerSync. */
async function conectarComoRol(clave: string): Promise<Client> {
  const c = new Client({
    host: "127.0.0.1",
    port: 54322,
    user: ROL,
    password: clave,
    database: "postgres",
  });
  await c.connect();
  return c;
}

function codigoDe(error: unknown): string {
  return (error as { code?: string })?.code ?? "";
}

/**
 * Comprueba que el rol existe, entra, y tiene los atributos que la replicación
 * necesita. Traduce cada fallo a su causa.
 */
async function comprobarRol(): Promise<void> {
  let c: Client;
  try {
    c = await conectarComoRol(CLAVE_ROL);
  } catch (error) {
    const codigo = codigoDe(error);
    if (codigo === "28P01") {
      throw new Error(
        `\`${ROL}\` existe con OTRA contraseña. El setup acaba de reescribirla, así que si esto persiste hay algo que la cambia por detrás (¿otro compose, otro proyecto apuntando al mismo Postgres?).`,
        { cause: error },
      );
    }
    if (codigo === "28000" || /does not exist/i.test(String(error))) {
      throw new Error(
        `el setup no pudo crear \`${ROL}\`. ¿El Postgres de 54322 es el de \`supabase start\` y no otro?`,
        { cause: error },
      );
    }
    if (codigo === "ECONNREFUSED") {
      throw new Error(
        "no hay Postgres escuchando en 54322: falta `supabase start`.",
        { cause: error },
      );
    }
    throw error;
  }

  try {
    // Un rol que ENTRA pero sin `replication` falla más tarde y peor: la conexión
    // de replicación muere y el síntoma vuelve a ser «no bajó nada».
    const atributos = await c.query<{
      rolreplication: boolean;
      rolbypassrls: boolean;
      rolcanlogin: boolean;
    }>(
      "select rolreplication, rolbypassrls, rolcanlogin from pg_roles where rolname = $1",
      [ROL],
    );
    const fila = atributos.rows[0];
    const faltan = [
      fila?.rolreplication ? null : "replication",
      fila?.rolbypassrls ? null : "bypassrls",
      fila?.rolcanlogin ? null : "login",
    ].filter((a): a is string => a !== null);
    if (faltan.length > 0) {
      throw new Error(
        `\`${ROL}\` entra pero le faltan atributos: ${faltan.join(", ")}. Reejecuta \`pnpm --filter @market-track/sync sync:setup\`.`,
      );
    }

    const pub = await c.query(
      "select 1 from pg_publication where pubname = 'powersync' and puballtables",
    );
    if (pub.rowCount === 0) {
      throw new Error(
        "falta la publicación `powersync`. `supabase db reset` se la lleva por delante: reejecuta `pnpm --filter @market-track/sync sync:setup`.",
      );
    }
  } finally {
    await c.end();
  }
}

/** Comprueba que el servicio de PowerSync responde. */
async function comprobarServicio(): Promise<void> {
  try {
    await fetch(POWERSYNC_URL, { signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new Error(
      `el servicio PowerSync no contesta en ${POWERSYNC_URL}: falta \`pnpm --filter @market-track/sync sync:up\`.`,
    );
  }
}

const ejecutar = promisify(execFile);

const COMPOSE = fileURLToPath(
  new URL("../config/docker-compose.yaml", import.meta.url),
);

/** ¿Hay una conexión de replicación viva de PowerSync contra ESTE Postgres? */
async function hayReplicacionViva(): Promise<boolean> {
  const c = new Client({ connectionString: PG });
  await c.connect();
  try {
    const r = await c.query(
      "select 1 from pg_replication_slots where slot_name like 'powersync%' and active",
    );
    return (r.rowCount ?? 0) > 0;
  } finally {
    await c.end();
  }
}

const STREAMS = fileURLToPath(
  new URL("../config/streams.yaml", import.meta.url),
);

/**
 * ¿El servicio arrancó ANTES de la última edición de las sync rules?
 *
 * PowerSync lee `streams.yaml` al arrancar y no lo recarga. Editar las reglas y
 * lanzar el harness sin reiniciar devuelve resultados de las reglas VIEJAS — y
 * eso es la misma mentira que este harness existe para no contar, solo que por
 * otro motivo: el veredicto no corresponde al código que se está mirando.
 *
 * Medido: pasó durante la revisión de este mismo cambio. Se mutaron las reglas,
 * se restauró el fichero y el servicio siguió sirviendo la versión mutada; el
 * harness dio un rojo que no correspondía a nada del árbol.
 */
async function laConfigEstaRancia(): Promise<boolean> {
  try {
    const [{ stdout: id }, reglas] = await Promise.all([
      ejecutar("docker", ["compose", "-f", COMPOSE, "ps", "-q", "powersync"]),
      stat(STREAMS),
    ]);
    if (!id.trim()) return false;
    const { stdout: arranque } = await ejecutar("docker", [
      "inspect",
      "-f",
      "{{.State.StartedAt}}",
      id.trim(),
    ]);
    return reglas.mtime.getTime() > new Date(arranque.trim()).getTime();
  } catch {
    // Si no se puede saber, no se decide por sospecha: el resto de
    // comprobaciones sigue su curso.
    return false;
  }
}

/**
 * Asegura que PowerSync está replicando contra la base ACTUAL.
 *
 * El slot de replicación es mejor señal que una sonda HTTP: el puerto contesta
 * aunque la replicación esté muerta, y entonces el harness baja cero filas y lo
 * reporta como un fallo de aislamiento. Un slot vivo significa que los datos
 * fluyen de verdad.
 *
 * Y hace falta porque `supabase db reset` reconstruye la base: el slot
 * desaparece y el servicio se queda sirviendo el checkpoint anterior — datos de
 * una base que ya no existe. Medido: tras un reset sin reiniciar, seis casos
 * fallan con aserciones que parecen de aislamiento y no lo son. Reiniciarlo lo
 * arregla; por eso lo hace el preflight y no una nota en el README que nadie lee
 * a las once de la noche.
 */
async function asegurarReplicacion(): Promise<void> {
  // Dos formas distintas de servir datos que no corresponden: sin slot es que la
  // base se recreó debajo; con la config rancia es que las reglas cambiaron
  // encima. Las dos se arreglan igual, y las dos hacen mentir al harness.
  if ((await hayReplicacionViva()) && !(await laConfigEstaRancia())) return;

  try {
    await ejecutar("docker", [
      "compose",
      "-f",
      COMPOSE,
      "restart",
      "powersync",
    ]);
  } catch {
    throw new Error(
      "PowerSync está sirviendo datos de una base anterior (no hay slot de replicación) y no se pudo reiniciar. Hazlo a mano: `pnpm --filter @market-track/sync sync:up` tras `sync:down`.",
    );
  }

  // La replicación inicial tarda: se espera al SLOT, no a un puerto abierto.
  const limite = Date.now() + 90_000;
  while (Date.now() < limite) {
    if (await hayReplicacionViva()) return;
    await new Promise((listo) => setTimeout(listo, 1_000));
  }

  throw new Error(
    "PowerSync no llegó a replicar en 90 s. Mira sus logs: `docker compose -f packages/sync/config/docker-compose.yaml logs --tail=200`.",
  );
}

/**
 * ¿El hook que entrega el OTP arranca?
 *
 * Todos los tests de aislamiento entran con una sesión aal2, y esa sesión no
 * existe sin este hook. Cuando no arranca, GoTrue devuelve un 500 sin cuerpo, el
 * cliente de Supabase lo traduce a un error vacío y el harness reporta diecisiete
 * fallos de aislamiento que no lo son. Medido: eso fue exactamente lo que pasó
 * durante un mes.
 *
 * La sonda es una petición SIN firmar, y lo que se espera es que la RECHACE:
 *
 * - **401** — la función arrancó y verifica firmas. Es el verde.
 * - **500** — no llegó a arrancar. Es configuración, no un fallo de las reglas.
 *
 * No se manda ninguna firma válida a propósito: comprobar que la puerta está
 * cerrada no puede exigir la llave.
 */
async function comprobarHookOtp(): Promise<void> {
  const url = `${SUPABASE_URL}/functions/v1/enviar-otp`;
  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(
      `la API de Supabase no contesta en ${SUPABASE_URL}: falta \`supabase start\`, o alguno de sus contenedores murió y \`supabase start\` no lo relevanta (compruébalo con \`docker ps -a --filter name=supabase_\`; se arregla con \`supabase stop\` y otro \`start\`).`,
      { cause: error },
    );
  }

  if (respuesta.status === 401) return;

  if (respuesta.status === 500) {
    throw new Error(
      "el hook del OTP (`enviar-otp`) no arranca, así que ninguna sesión de segundo factor es posible y los tests de aislamiento NO están probando nada. Casi siempre es `SEND_SMS_HOOK_SECRET`: tiene formato `v1,whsec_<base64>` y el MISMO valor tiene que estar en `.env` (lo lee GoTrue) y en `supabase/functions/.env` (lo lee la función). Ver SETUP.md. El motivo exacto está en `docker logs supabase_edge_runtime_market-track`.",
    );
  }

  throw new Error(
    `el hook del OTP respondió ${respuesta.status} a una petición sin firmar, y se esperaba 401. Mira \`docker logs supabase_edge_runtime_market-track\`.`,
  );
}

/**
 * Deja el entorno listo y comprueba que lo está. Se llama desde el `beforeAll`
 * del harness: un prerrequisito que falta tiene que decirlo él, no aparecer
 * disfrazado de fallo de aislamiento veinticinco segundos después.
 */
export async function prepararHarness(): Promise<void> {
  if (!process.env.ANON_KEY) {
    throw new Error(
      "Falta ANON_KEY. Sácala de `pnpm exec supabase status -o env` y pásala en el entorno.",
    );
  }
  await prepararPostgres();
  await comprobarRol();
  // Antes que PowerSync: sin sesión aal2 no hay nada que replicar, y esperar 90 s
  // a un slot para luego morir en el login es hacer perder el tiempo dos veces.
  await comprobarHookOtp();
  await comprobarServicio();
  await asegurarReplicacion();
}
