import {
  type AbstractPowerSyncDatabase,
  column,
  type PowerSyncBackendConnector,
  PowerSyncDatabase,
  Schema,
  Table,
} from "@powersync/node";
import { createClient, type Session } from "@supabase/supabase-js";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

// Harness de aislamiento de las sync rules (MAR-26).
//
// La lectura del móvil NO pasa por RLS: PowerSync replica con BYPASSRLS y lo que
// baja lo deciden SOLO las sync rules. Un harness que pruebe RLS da un falso
// verde para el móvil. Este prueba la superficie de verdad: conecta clientes
// PowerSync reales como distintos usuarios y afirma qué se replica.
//
// Prerrequisitos (documentados, como test:db exige `supabase start`):
//   - `supabase start`
//   - `supabase functions serve` (el hook que entrega el OTP del 2FA)
//   - `pnpm --filter @market-track/sync sync:up`

export const SUPABASE_URL = "http://127.0.0.1:54321";
export const POWERSYNC_URL = "http://127.0.0.1:8080";
const PG = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export const USUARIOS = {
  joseMaracumango: {
    email: "jose.quispe@markettrack.pe",
    id: "44444444-4444-4444-4444-444444444444",
    tenant: "aaaaaaaa-0000-0000-0000-000000000001",
  },
  mercaRival: {
    email: "merca.rival@markettrack.pe",
    id: "66666666-6666-6666-6666-666666666666",
    tenant: "bbbbbbbb-0000-0000-0000-000000000002",
  },
} as const;

export const CLAVE = "password123";

// El esquema del cliente. Solo text/integer/real; el aislamiento no depende de
// las columnas, solo de qué FILAS llegan. Basta con tenant_id para verificarlo.
function tablaTenant() {
  return new Table({ tenant_id: column.text, nombre: column.text });
}
export const AppSchema = new Schema({
  tienda: tablaTenant(),
  sku: tablaTenant(),
  visita: new Table({ tenant_id: column.text, mercaderista_id: column.text }),
  cadena: tablaTenant(),
  marca: tablaTenant(),
  rutero: new Table({
    tenant_id: column.text,
    mercaderista_id: column.text,
    estado: column.text,
  }),
  rutero_parada: new Table({
    tenant_id: column.text,
    rutero_id: column.text,
  }),
  revision_visita: new Table({
    tenant_id: column.text,
    visita_id: column.text,
    decision: column.text,
  }),
  foto: new Table({
    tenant_id: column.text,
    visita_id: column.text,
    subida_at: column.text,
  }),
  levantamiento: new Table({ tenant_id: column.text, visita_id: column.text }),
  levantamiento_sku: new Table({
    tenant_id: column.text,
    levantamiento_id: column.text,
  }),
  levantamiento_respuesta: new Table({
    tenant_id: column.text,
    levantamiento_id: column.text,
  }),
  exhibicion: new Table({
    tenant_id: column.text,
    levantamiento_id: column.text,
  }),
  contingencia: new Table({ tenant_id: column.text, visita_id: column.text }),
});

function anonKey(): string {
  const k = process.env.ANON_KEY;
  if (!k) throw new Error("falta ANON_KEY en el entorno del harness");
  return k;
}

/** Un cliente de Supabase suelto (sin persistir sesión). */
function supa() {
  return createClient(SUPABASE_URL, anonKey(), {
    auth: { persistSession: false },
  });
}

/** Inicia sesión y devuelve la sesión en aal1 (solo contraseña). */
export async function sesionAal1(email: string): Promise<Session> {
  const s = supa();
  const { data, error } = await s.auth.signInWithPassword({
    email,
    password: CLAVE,
  });
  if (error || !data.session)
    throw new Error(`login ${email}: ${error?.message}`);
  return data.session;
}

/**
 * Inicia sesión y completa el segundo factor: devuelve una sesión en aal2.
 *
 * Enrola el factor Teléfono si falta, pide el challenge (que dispara el hook) y
 * lee el OTP de `auth.mfa_challenges` por SQL — en local el código está en la
 * base; en producción va al correo del usuario y nadie lo lee de ahí.
 */
export async function sesionAal2(email: string): Promise<Session> {
  const s = supa();
  const { data: login, error } = await s.auth.signInWithPassword({
    email,
    password: CLAVE,
  });
  if (error || !login.session)
    throw new Error(`login ${email}: ${error?.message}`);

  const factores = await s.auth.mfa.listFactors();
  const existente = factores.data?.all?.find((f) => f.factor_type === "phone");
  let factorId: string;
  if (existente) {
    factorId = existente.id;
  } else {
    const { data, error: e } = await s.auth.mfa.enroll({
      factorType: "phone",
      phone: `+519${Math.floor(10000000 + Math.random() * 89999999)}`,
    });
    if (e || !data) throw new Error(`enroll ${email}: ${e?.message}`);
    factorId = data.id;
  }
  // Supabase limita los challenge por usuario ("only request this after N
  // seconds"). El harness pide varios seguidos: se respeta el límite y se
  // reintenta, en vez de fallar por algo que no es de seguridad.
  const reto = await retarConEspera(s, factorId, email);

  const pg = new Client({ connectionString: PG });
  await pg.connect();
  const r = await pg.query<{ otp_code: string }>(
    "select otp_code from auth.mfa_challenges where id = $1",
    [reto.data.id],
  );
  await pg.end();
  const otp = r.rows[0]?.otp_code;
  if (!otp) throw new Error("el hook no dejó OTP en auth.mfa_challenges");

  const ver = await s.auth.mfa.verify({
    factorId,
    challengeId: reto.data.id,
    code: otp,
  });
  if (ver.error || !ver.data.access_token) {
    throw new Error(`verify ${email}: ${ver.error?.message}`);
  }
  return ver.data;
}

type SupaClient = ReturnType<typeof supa>;

/** Pide el challenge respetando el rate limit de Supabase (reintenta la espera). */
async function retarConEspera(s: SupaClient, factorId: string, email: string) {
  for (let intento = 0; intento < 5; intento++) {
    const reto = await s.auth.mfa.challenge({ factorId });
    if (!reto.error) return reto;
    const segundos = /after (\d+) seconds?/.exec(reto.error.message)?.[1];
    if (!segundos) throw new Error(`challenge ${email}: ${reto.error.message}`);
    await new Promise((r) => setTimeout(r, (Number(segundos) + 1) * 1000));
  }
  throw new Error(`challenge ${email}: el rate limit no cedió tras 5 intentos`);
}

/** Espera el primer sync o el deadline, lo que llegue antes. */
async function esperarPrimerSync(db: AbstractPowerSyncDatabase, ms: number) {
  await Promise.race([
    db.waitForFirstSync(),
    new Promise((r) => setTimeout(r, ms)),
  ]);
}

class ConectorSoloLectura implements PowerSyncBackendConnector {
  constructor(private readonly sesion: Session) {}
  fetchCredentials() {
    return Promise.resolve({
      endpoint: POWERSYNC_URL,
      token: this.sesion.access_token,
    });
  }
  // El harness solo verifica la BAJADA; no sube nada.
  async uploadData() {
    /* sin subida */
  }
}

/**
 * Abre una réplica local, sincroniza con la sesión dada y devuelve cuántas filas
 * de cada tabla llegaron. Cierra y borra la base al terminar.
 */
export async function replicarCon(
  sesion: Session,
  tablas: readonly string[],
): Promise<Record<string, number>> {
  const nombre = `harness-${randomUUID()}`;
  for (const ext of ["", "-wal", "-shm"]) {
    rmSync(`${nombre}.db${ext}`, { force: true });
  }
  const db = new PowerSyncDatabase({
    schema: AppSchema,
    database: { dbFilename: `${nombre}.db` },
  });
  await db.init();
  await db.connect(new ConectorSoloLectura(sesion));

  try {
    await esperarPrimerSync(db, 25000);
    // Un margen para que asienten las tablas tras el primer checkpoint.
    await new Promise((r) => setTimeout(r, 1500));
    const conteo: Record<string, number> = {};
    for (const t of tablas) {
      const filas = await db.getAll<{ tenant_id?: string }>(
        `SELECT * FROM ${t}`,
      );
      conteo[t] = filas.length;
    }
    return conteo;
  } finally {
    await db.disconnect();
    await db.close();
    for (const ext of ["", "-wal", "-shm"]) {
      rmSync(`${nombre}.db${ext}`, { force: true });
    }
  }
}

/** Las filas de una tabla replicada, para inspeccionar de qué tenant son. */
export async function filasReplicadas<T = { tenant_id: string }>(
  sesion: Session,
  tabla: string,
  /** Qué columnas leer. Por defecto basta `tenant_id` para probar aislamiento. */
  columnas = "tenant_id",
): Promise<T[]> {
  const nombre = `harness-${randomUUID()}`;
  const db = new PowerSyncDatabase({
    schema: AppSchema,
    database: { dbFilename: `${nombre}.db` },
  });
  await db.init();
  await db.connect(new ConectorSoloLectura(sesion));
  try {
    await esperarPrimerSync(db, 25000);
    await new Promise((r) => setTimeout(r, 1500));
    return await db.getAll<T>(`SELECT ${columnas} FROM ${tabla}`);
  } finally {
    await db.disconnect();
    await db.close();
    for (const ext of ["", "-wal", "-shm"]) {
      rmSync(`${nombre}.db${ext}`, { force: true });
    }
  }
}

/** Cambia `tenant.activo` (para probar el corte del excliente). Se revierte solo. */
export async function conTenantDesactivado<T>(
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const pg = new Client({ connectionString: PG });
  await pg.connect();
  await pg.query("update public.tenant set activo = false where id = $1", [
    tenantId,
  ]);
  try {
    return await fn();
  } finally {
    await pg.query("update public.tenant set activo = true where id = $1", [
      tenantId,
    ]);
    await pg.end();
  }
}

/**
 * El trabajo de campo de un COMPAÑERO del mismo cliente (una visita con su
 * levantamiento, sku, respuesta, exhibición y contingencia), sembrado directo en
 * Postgres para probar que NO baja al teléfono de José. Se borra al terminar: la
 * visita arrastra el resto por cascade.
 *
 * El seed solo trae una visita por mercaderista, así que sin esto la afirmación
 * "no baja lo ajeno" pasaría en verde con la regla rota.
 */
export const TRABAJO_COMPANERO = {
  visita: "f0000010-0000-0000-0000-000000000096",
  levantamiento: "f0000011-0000-0000-0000-000000000096",
  levantamientoSku: "f0000012-0000-0000-0000-000000000096",
  respuesta: "f0000047-0000-0000-0000-000000000096",
  exhibicion: "f0000013-0000-0000-0000-000000000096",
  contingencia: "f0000014-0000-0000-0000-000000000096",
  /** Una respuesta PROPIA de José, en su levantamiento del seed: el control
   * positivo de que la réplica ya asentó lo sembrado antes de afirmar nada. */
  respuestaPropiaDeJose: "f0000047-0000-0000-0000-000000000095",
} as const;

export async function conTrabajoDeCompanero<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const tenant = USUARIOS.joseMaracumango.tenant;
  const companero = "55555555-5555-5555-5555-555555555555";
  const pg = new Client({ connectionString: PG });
  await pg.connect();
  const T = TRABAJO_COMPANERO;
  try {
    await pg.query(
      `insert into public.visita (id, tenant_id, rutero_parada_id, mercaderista_id, tienda_id, estado)
       values ($1, $2, 'a0000009-0000-0000-0000-000000000001', $3, 'a0000002-0000-0000-0000-000000000001', 'en_curso')`,
      [T.visita, tenant, companero],
    );
    await pg.query(
      `insert into public.levantamiento (id, tenant_id, visita_id, marca_id)
       values ($1, $2, $3, 'cccccccc-0000-0000-0000-000000000001')`,
      [T.levantamiento, tenant, T.visita],
    );
    await pg.query(
      `insert into public.levantamiento_sku (id, tenant_id, levantamiento_id, sku_id, stock_sistema, stock_piso, precio_registrado)
       values ($1, $2, $3, 'a0000003-0000-0000-0000-000000000001', 5, 1, 6.90)`,
      [T.levantamientoSku, tenant, T.levantamiento],
    );
    await pg.query(
      `insert into public.levantamiento_respuesta (id, tenant_id, levantamiento_id, campo_id, valor)
       values ($1, $2, $3, 'observacion', '"góndola sucia"'::jsonb)`,
      [T.respuesta, tenant, T.levantamiento],
    );
    await pg.query(
      `insert into public.exhibicion (id, tenant_id, levantamiento_id, exhibicion_negociada_id, instalada)
       values ($1, $2, $3, 'a0000007-0000-0000-0000-000000000001', false)`,
      [T.exhibicion, tenant, T.levantamiento],
    );
    await pg.query(
      `insert into public.contingencia (id, tenant_id, visita_id, paso, motivo, registrada_at)
       values ($1, $2, $3, 'precios', 'harness: bypass del compañero', now())`,
      [T.contingencia, tenant, T.visita],
    );
    await pg.query(
      `insert into public.levantamiento_respuesta (id, tenant_id, levantamiento_id, campo_id, valor)
       values ($1, $2, 'a0000011-0000-0000-0000-000000000001', 'harness', '"propia"'::jsonb)`,
      [T.respuestaPropiaDeJose, tenant],
    );
    return await fn();
  } finally {
    await pg.query(`delete from public.levantamiento_respuesta where id = $1`, [
      T.respuestaPropiaDeJose,
    ]);
    await pg.query(`delete from public.visita where id = $1`, [T.visita]);
    await pg.end();
  }
}
