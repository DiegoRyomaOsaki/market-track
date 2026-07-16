import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  comoUsuario,
  conectar,
  contarFilas,
  tablasConTenant,
  tablasDeNegocio,
  TENANTS,
  USUARIOS,
} from "./ayudas";

// La red de seguridad que convierte la promesa contractual —"cada cliente ve
// únicamente su información"— en algo VERIFICABLE.
//
// ⚠️⚠️ ESTE ARNÉS NO CUBRE EL MÓVIL. ⚠️⚠️
//
// PowerSync replica desde Postgres con un rol `BYPASSRLS`: la BAJADA de datos al
// teléfono NO pasa por ninguna de estas políticas. Lo que el mercaderista se
// descarga lo deciden EXCLUSIVAMENTE las sync rules.
//
// Es decir: este archivo puede estar entero en verde y el móvil seguir filtrando
// datos entre clientes. Cubre la escritura del móvil (que sí sube por PostgREST)
// y todo el camino de la web. La lectura del móvil es una SEGUNDA SUPERFICIE de
// seguridad, y necesita su propio arnés cuando exista la app.
// Ver docs/adr/0001-motor-offline-dedicado.md.

let db: Client;
let tablas: string[];
let conTenant: string[];

beforeAll(async () => {
  db = await conectar();
  tablas = await tablasDeNegocio(db);
  conTenant = await tablasConTenant(db);
});

afterAll(async () => {
  await db.end();
});

describe("invariantes del esquema (descubiertas del catálogo, no de una lista)", () => {
  it("NINGUNA tabla de negocio se queda sin RLS", async () => {
    const sinRls = await db.query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    `);
    // Una tabla sin RLS es legible por el mundo a través de PostgREST.
    expect(sinRls.rows.map((r) => r.relname)).toEqual([]);
  });

  it("NINGUNA tabla con RLS se queda sin políticas (fallaría cerrada, pero muda)", async () => {
    const sinPoliticas = await db.query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
        and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
    `);
    expect(sinPoliticas.rows.map((r) => r.relname)).toEqual([]);
  });

  it("NINGUNA tabla se queda sin GRANT: el error de RLS mentiría", async () => {
    // El GRANT es la puerta; la RLS es el portero. Sin grant, la consulta muere
    // con 42501 ANTES de que ninguna política se evalúe — y parece un fallo de RLS.
    // Ojo: has_table_privilege da FALSE si el grant es solo por COLUMNA.
    const sinGrant = await db.query<{ relname: string }>(`
      select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and not has_table_privilege('authenticated', c.oid, 'SELECT')
        and not exists (
          select 1 from information_schema.column_privileges cp
          where cp.table_schema = 'public' and cp.table_name = c.relname
            and cp.grantee = 'authenticated' and cp.privilege_type = 'SELECT'
        )
    `);
    expect(sinGrant.rows.map((r) => r.relname)).toEqual([]);
  });

  it("NINGUNA política llama a app.* sin envolverla en (select ...)", async () => {
    // Sin el select, Postgres la evalúa una vez POR FILA. Medido sobre 200.000
    // filas: 42.480 ms contra 12,9 ms. Es un fallo de rendimiento SILENCIOSO:
    // funciona perfecto con 3 filas de prueba y tumba el dashboard en producción.
    const malas = await db.query<{ polname: string }>(`
      select p.polname
      from pg_policy p join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and (coalesce(pg_get_expr(p.polqual, p.polrelid), '')
          || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
            ~* '(?<!SELECT )app\\.(es_staff|rol_actual|tenant_actual)\\(\\)'
    `);
    expect(malas.rows.map((r) => r.polname)).toEqual([]);
  });
});

describe("aislamiento entre clientes — la promesa contractual", () => {
  it("el mercaderista del cliente RIVAL no alcanza NI UNA fila de Maracumango, en NINGUNA tabla", async () => {
    const fugas: string[] = [];

    await comoUsuario(db, USUARIOS.mercaderistaRival, async (c) => {
      for (const tabla of conTenant) {
        const r = await c.query<{ n: string }>(
          `select count(*)::text as n from public.${tabla} where tenant_id = $1`,
          [TENANTS.maracumango],
        );
        if (Number(r.rows[0]?.n ?? "0") > 0) fugas.push(tabla);
      }
    });

    // Si esto falla, el contrato está roto. No es un test más.
    expect(fugas).toEqual([]);
  });

  it("el usuario del cliente Maracumango tampoco alcanza al rival", async () => {
    const fugas: string[] = [];

    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      for (const tabla of conTenant) {
        const r = await c.query<{ n: string }>(
          `select count(*)::text as n from public.${tabla} where tenant_id = $1`,
          [TENANTS.rival],
        );
        if (Number(r.rows[0]?.n ?? "0") > 0) fugas.push(tabla);
      }
    });

    expect(fugas).toEqual([]);
  });

  it("cubre TODAS las tablas de negocio, no una muestra", () => {
    // Si alguien añade una tabla, entra sola en el test de arriba. Este control
    // solo confirma que el descubrimiento del catálogo encontró algo.
    expect(tablas.length).toBeGreaterThan(15);
    expect(conTenant.length).toBeGreaterThan(15);
  });
});

describe("los cuatro roles", () => {
  it("admin: ve los dos clientes", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      expect(await contarFilas(c, "tenant")).toBe(2);
    });
  });

  it("supervisor: ve los dos clientes (es staff de la outsourcing)", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      expect(await contarFilas(c, "tenant")).toBe(2);
    });
  });

  it("cliente: solo el suyo", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      const r = await c.query<{ id: string }>("select id from public.tenant");
      expect(r.rows.map((x) => x.id)).toEqual([TENANTS.maracumango]);
    });
  });

  it("mercaderista: solo el suyo, y solo su propio perfil", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const t = await c.query<{ id: string }>("select id from public.tenant");
      expect(t.rows.map((x) => x.id)).toEqual([TENANTS.maracumango]);

      // No ve el DNI ni el teléfono de sus compañeros: son datos personales.
      const p = await c.query<{ id: string }>("select id from public.profile");
      expect(p.rows.map((x) => x.id)).toEqual([
        USUARIOS.mercaderistaMaracumango,
      ]);
    });
  });
});

describe("revocación: el acceso es derivado, no una copia", () => {
  it("el mercaderista DESVINCULADO no ve nada, pero sí su propia fila", async () => {
    await comoUsuario(db, USUARIOS.desvinculado, async (c) => {
      expect(await contarFilas(c, "marca")).toBe(0);
      // Sí ve su perfil: la app tiene que poder decirle "tu cuenta está
      // desactivada" en vez de dejarlo mirando una pantalla vacía.
      expect(await contarFilas(c, "profile")).toBe(1);
    });
  });

  it("si el CLIENTE CANCELA, sus mercaderistas pierden el acceso al instante", async () => {
    await db.query("begin");
    try {
      await db.query("update public.tenant set activo = false where id = $1", [
        TENANTS.maracumango,
      ]);

      await db.query("set local role authenticated");
      // `aal2` va explícito: sin él, este test pasaría por el gate del segundo
      // factor en vez de por la cancelación del cliente — un verde falso que no
      // probaría nada de lo que dice probar.
      await db.query(
        `set local request.jwt.claims = '${JSON.stringify({ sub: USUARIOS.mercaderistaMaracumango, role: "authenticated", aal: "aal2" })}'`,
      );

      // Sin esperar a que expire ningún token: la regla se recalcula en cada
      // consulta. Por eso el rol NO va en los claims del JWT.
      expect(await contarFilas(db, "marca")).toBe(0);
      expect(await contarFilas(db, "tenant")).toBe(0);
    } finally {
      await db.query("rollback");
    }
  });
});

describe("segundo factor: el gate aal2 protege los DATOS, no solo la pantalla", () => {
  it("una sesión SIN aal2 no ve nada, ni siendo admin", async () => {
    // El middleware protege la UI; esto protege la fila. Una petición hecha a mano
    // contra PostgREST con un token aal1 no puede leer, que es justo el hueco que
    // el gate del middleware por sí solo dejaba abierto (ADR-0008, punto 4).
    await comoUsuario(
      db,
      USUARIOS.admin,
      async (c) => {
        expect(await contarFilas(c, "marca")).toBe(0);
        expect(await contarFilas(c, "tenant")).toBe(0);
      },
      { aal: "aal1" },
    );
  });

  it("sin aal2 SÍ ve su propia fila de profile, y tiene que ser así", async () => {
    // `profile_lee_el_suyo` no pasa por perfil_efectivo a propósito: el middleware
    // lee el rol con la sesión aal1 —antes del segundo factor— para saber a dónde
    // mandarte. Si esto se cerrara, no habría forma de llegar al paso de 2FA.
    await comoUsuario(
      db,
      USUARIOS.admin,
      async (c) => {
        expect(await contarFilas(c, "profile")).toBe(1);
      },
      { aal: "aal1" },
    );
  });

  it("el mismo admin CON aal2 sí ve la operación", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      expect(await contarFilas(c, "marca")).toBeGreaterThan(0);
      expect(await contarFilas(c, "tenant")).toBeGreaterThan(0);
    });
  });
});
