import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PG } from "./ayudas";
import { prepararPostgres } from "./preparacion";

// El setup de Postgres tiene que REPARAR el rol, no solo crearlo.
//
// El `if not exists ... then create role` original pasaba de largo cuando el rol
// existía con la contraseña equivocada, y la replicación seguía muerta con un
// `28P01` que parece un problema de entorno del desarrollador. Estos casos lo
// fijan: se rompe el rol a propósito y se comprueba que reejecutar el setup lo
// devuelve al estado que declara.
//
// Va en su propio fichero porque su único prerrequisito es Postgres —ni PowerSync
// ni Auth— y porque SABOTEA estado compartido. Por eso `test:sync` corre sin
// paralelismo entre ficheros.

const ROL = "powersync_role";
const CLAVE = "powersync_local";

/** Conecta como el rol, igual que hace PowerSync: desde fuera del contenedor,
 *  donde `pg_hba` exige `scram-sha-256` y la contraseña SÍ se comprueba. */
async function entrarComoRol(clave: string): Promise<Client> {
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

async function comoSuperusuario<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: PG });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

// En una base recién creada el rol NO existe todavía, y estos casos empiezan
// rompiéndolo: sin esto, el primer `alter role` muere con `42704 role does not
// exist`. En una máquina donde ya se corrió el harness antes no se nota — lo
// destapó la primera corrida en CI.
beforeAll(prepararPostgres);

// Pase lo que pase, el rol queda reparado: un fallo a mitad no puede dejar la
// replicación rota para el resto de la sesión ni para la siguiente.
afterAll(prepararPostgres);

describe("el setup de Postgres repara el rol de replicación", () => {
  it("con la contraseña cambiada, entrar da 28P01", async () => {
    // El control positivo del test de abajo: sin esto, «entra tras el setup»
    // sería trivialmente cierto porque nunca dejó de entrar.
    await comoSuperusuario((c) =>
      c.query(`alter role ${ROL} password 'la-que-no-es'`),
    );

    await expect(entrarComoRol(CLAVE)).rejects.toMatchObject({
      code: "28P01",
    });
  });

  it("reejecutar el setup lo arregla", async () => {
    await comoSuperusuario((c) =>
      c.query(`alter role ${ROL} password 'la-que-no-es'`),
    );

    await prepararPostgres();

    const c = await entrarComoRol(CLAVE);
    await c.end();
  });

  it("y lo deja con los atributos que la replicación necesita", async () => {
    // Un rol que entra pero sin `replication` falla más tarde y peor: la conexión
    // muere y el síntoma vuelve a ser «no bajó nada».
    await comoSuperusuario((c) =>
      c.query(`alter role ${ROL} nologin noreplication nobypassrls`),
    );

    await prepararPostgres();

    const fila = await comoSuperusuario((c) =>
      c.query<{
        rolreplication: boolean;
        rolbypassrls: boolean;
        rolcanlogin: boolean;
      }>(
        "select rolreplication, rolbypassrls, rolcanlogin from pg_roles where rolname = $1",
        [ROL],
      ),
    );

    expect(fila.rows[0]).toEqual({
      rolreplication: true,
      rolbypassrls: true,
      rolcanlogin: true,
    });
  });

  it("y recrea la publicación, que `db reset` se lleva por delante", async () => {
    await comoSuperusuario((c) =>
      c.query("drop publication if exists powersync"),
    );

    await prepararPostgres();

    const pub = await comoSuperusuario((c) =>
      c.query(
        "select puballtables from pg_publication where pubname = 'powersync'",
      ),
    );
    expect(pub.rows[0]).toEqual({ puballtables: true });
  });
});
