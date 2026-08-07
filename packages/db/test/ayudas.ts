import { Client } from "pg";

// Utilidades para probar el aislamiento contra el Postgres local.
//
// La conexión va como `postgres` (superusuario) y luego SE REBAJA a
// `authenticated` dentro de una transacción, suplantando a un usuario con
// `request.jwt.claims`. Es exactamente lo que hace PostgREST cuando llega una
// petición con su JWT: mismo rol, mismos claims, mismas políticas.
//
// Todo corre dentro de una transacción con ROLLBACK, así que los tests no se
// pisan entre sí ni dejan basura.

const CADENA_LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** Los usuarios del seed. Dos clientes distintos: sin un segundo, no hay nada que aislar. */
export const USUARIOS = {
  admin: "11111111-1111-1111-1111-111111111111",
  supervisor: "22222222-2222-2222-2222-222222222222",
  clienteMaracumango: "33333333-3333-3333-3333-333333333333",
  mercaderistaMaracumango: "44444444-4444-4444-4444-444444444444",
  desvinculado: "55555555-5555-5555-5555-555555555555",
  mercaderistaRival: "66666666-6666-6666-6666-666666666666",
  /** Un supervisor SIN equipo: lo que hace demostrable "solo los suyos". */
  supervisorSinEquipo: "77777777-7777-7777-7777-777777777777",
} as const;

export const TENANTS = {
  maracumango: "aaaaaaaa-0000-0000-0000-000000000001",
  rival: "bbbbbbbb-0000-0000-0000-000000000002",
} as const;

export async function conectar(): Promise<Client> {
  const client = new Client({ connectionString: CADENA_LOCAL });
  await client.connect();
  return client;
}

/**
 * Corre una consulta SUPLANTANDO a un usuario, igual que haría PostgREST.
 * Siempre en una transacción que se revierte: ningún test ensucia al siguiente.
 *
 * El claim `aal` va en los claims porque `app.perfil_efectivo()` exige `aal2`
 * (ADR-0008): una sesión sin segundo factor no ve nada. Por defecto se suplanta a
 * un usuario que YA lo completó, que es el caso normal; pasar `aal: "aal1"` sirve
 * para probar el gate mismo.
 */
export async function comoUsuario<T>(
  client: Client,
  userId: string,
  fn: (c: Client) => Promise<T>,
  opciones?: { aal?: "aal1" | "aal2" },
): Promise<T> {
  await client.query("begin");
  try {
    await client.query("set local role authenticated");
    const claims = {
      sub: userId,
      role: "authenticated",
      aal: opciones?.aal ?? "aal2",
    };
    await client.query(
      `set local request.jwt.claims = '${JSON.stringify(claims)}'`,
    );
    return await fn(client);
  } finally {
    await client.query("rollback");
  }
}

/** Cuántas filas ve este usuario en esta tabla. La pregunta central del harness. */
export async function contarFilas(
  client: Client,
  tabla: string,
): Promise<number> {
  const r = await client.query<{ n: string }>(
    `select count(*)::text as n from public.${tabla}`,
  );
  return Number(r.rows[0]?.n ?? "0");
}

/**
 * Las tablas de negocio, DESCUBIERTAS DEL CATÁLOGO — nunca una lista a mano.
 *
 * Es lo que hace que el harness no se quede viejo: una tabla nueva entra sola en
 * todos los tests. Si alguien la crea sin RLS o sin políticas, el build se rompe
 * sin que nadie tenga que acordarse de añadirla aquí.
 */
export async function tablasDeNegocio(client: Client): Promise<string[]> {
  const r = await client.query<{ relname: string }>(`
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  `);
  return r.rows.map((x) => x.relname);
}

/** Las que llevan `tenant_id`: son las que tienen algo que aislar. */
export async function tablasConTenant(client: Client): Promise<string[]> {
  const r = await client.query<{ table_name: string }>(`
    select table_name
    from information_schema.columns
    where table_schema = 'public' and column_name = 'tenant_id'
    order by table_name
  `);
  return r.rows.map((x) => x.table_name);
}
