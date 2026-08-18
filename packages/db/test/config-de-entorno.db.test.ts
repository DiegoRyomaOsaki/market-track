import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cargarConfig, conectar } from "./ayudas";

// La configuración que leen los webhooks (`functions_url` y los dos secretos
// compartidos) vive en `supabase_vault`, no en GUCs `app.settings.*`: en un
// Supabase gestionado esas GUCs NO SE PUEDEN PONER —`alter database … set` de un
// parámetro placeholder exige superusuario desde Postgres 15 y `postgres` no lo
// es—, y creerlo dejó a staging sin enviar un solo correo desde que existe.
//
// Aquí se prueban las dos mitades: que `app.config` lee lo que hay, y que
// `app.config_faltante` dice lo que no hay — que es de lo que tira el despliegue
// para ponerse rojo en vez de callarse.

const CLAVES = [
  "functions_url",
  "alerta_webhook_secret",
  "foto_verificacion_secret",
];

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

async function config(clave: string): Promise<string | null> {
  const r = await db.query<{ valor: string | null }>(
    "select app.config($1) as valor",
    [clave],
  );
  return r.rows[0]?.valor ?? null;
}

async function faltante(): Promise<string[]> {
  const r = await db.query<{ faltan: string[] }>(
    "select app.config_faltante() as faltan",
  );
  return r.rows[0]?.faltan ?? [];
}

describe("app.config", () => {
  it("devuelve el valor cargado en el vault", async () => {
    await db.query("begin");
    try {
      await cargarConfig(db, "functions_url", "http://localhost:9999/v1");
      expect(await config("functions_url")).toBe("http://localhost:9999/v1");
    } finally {
      await db.query("rollback");
    }
  });

  it("devuelve NULL para una clave que no está cargada", async () => {
    // El caso de local, y el motivo de que el no-op de los webhooks exista.
    expect(await config("functions_url")).toBeNull();
    expect(await config("una_clave_que_nadie_ha_creado")).toBeNull();
  });
});

describe("app.config_faltante", () => {
  it("nombra las tres claves obligatorias cuando el vault está vacío", async () => {
    expect(await faltante()).toEqual([...CLAVES].sort());
  });

  it("deja de nombrar la clave en cuanto se carga", async () => {
    await db.query("begin");
    try {
      await cargarConfig(db, "functions_url", "http://localhost:9999/v1");
      expect(await faltante()).not.toContain("functions_url");
      expect(await faltante()).toHaveLength(CLAVES.length - 1);
    } finally {
      await db.query("rollback");
    }
  });

  it("sigue nombrando una clave cargada con el valor vacío", async () => {
    // Una clave presente pero vacía deja el webhook igual de mudo que una
    // ausente: un `is not null` a secas daría verde y no arreglaría nada.
    await db.query("begin");
    try {
      await cargarConfig(db, "alerta_webhook_secret", "");
      expect(await faltante()).toContain("alerta_webhook_secret");
    } finally {
      await db.query("rollback");
    }
  });

  it("no devuelve ningún valor, solo nombres", async () => {
    // Su respuesta acaba en el log de un runner de CI: un secreto que saliera
    // por aquí quedaría escrito en claro para siempre.
    await db.query("begin");
    try {
      await cargarConfig(db, "alerta_webhook_secret", "un-secreto-de-verdad");
      expect(await faltante()).not.toContain("un-secreto-de-verdad");
    } finally {
      await db.query("rollback");
    }
  });
});

describe("quién puede leer la configuración", () => {
  it("ni anon ni authenticated pueden ejecutar app.config", async () => {
    // Quien la ejecute lee los secretos EN CLARO. `app` no está expuesto por
    // PostgREST, pero eso es la segunda cerradura, no la primera.
    const r = await db.query<{ rol: string; puede: boolean }>(
      `select rolname as rol,
              has_function_privilege(rolname, 'app.config(text)', 'execute') as puede
       from pg_roles where rolname in ('anon', 'authenticated') order by rolname`,
    );

    expect(r.rows).toHaveLength(2);
    for (const fila of r.rows) expect(fila.puede).toBe(false);
  });

  it("ni anon ni authenticated leen el vault directamente", async () => {
    const r = await db.query<{ rol: string; puede: boolean }>(
      `select rolname as rol,
              has_table_privilege(rolname, 'vault.decrypted_secrets', 'select') as puede
       from pg_roles where rolname in ('anon', 'authenticated') order by rolname`,
    );

    expect(r.rows).toHaveLength(2);
    for (const fila of r.rows) expect(fila.puede).toBe(false);
  });
});
