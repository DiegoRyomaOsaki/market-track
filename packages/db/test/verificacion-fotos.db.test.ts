import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// La autenticidad de `foto` (`verificada_at`, `bytes_r2`,
// `verificacion_intento_at`) la escribe SOLO el servidor: la Edge Function
// `fotos-verificar` con service_role, tras un HEAD contra R2. La app no puede ni
// insertarla ni cambiarla — lo impide un trigger, no un grant por columna, para
// que el upsert de fila entera con que PowerSync reintenta siga pasando. Y la
// identidad de la foto se congela en el mismo trigger.
//
// Todo dentro de transacciones que revierten; cada test siembra lo suyo.

const IDS = {
  visitaMrc: "a0000010-0000-0000-0000-000000000001",
  levantamientoMrc: "a0000011-0000-0000-0000-000000000001",
  fotoNueva: "e0000015-0000-0000-0000-000000000090",
  fotoNueva2: "e0000015-0000-0000-0000-000000000091",
  fotoNueva3: "e0000015-0000-0000-0000-000000000092",
  fotoNueva4: "e0000015-0000-0000-0000-000000000093",
} as const;

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

/** Como el servidor: service_role dentro de una transacción que revierte. */
async function comoServicio<T>(
  c: Client,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  await c.query("begin");
  try {
    await c.query("set local role service_role");
    return await fn(c);
  } finally {
    await c.query("rollback");
  }
}

/**
 * Siembra como postgres y DESPUÉS se rebaja al mercaderista dueño, todo en una
 * transacción que revierte. Para los casos en que la fila tiene que existir ya
 * sellada (cosa que el mercaderista no puede hacer) antes de que él la toque.
 */
async function sembradoLuegoMercaderista<T>(
  c: Client,
  sembrar: (c: Client) => Promise<void>,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  await c.query("begin");
  try {
    await sembrar(c);
    await c.query("set local role authenticated");
    const claims = {
      sub: USUARIOS.mercaderistaMaracumango,
      role: "authenticated",
      aal: "aal2",
    };
    await c.query(`set local request.jwt.claims = '${JSON.stringify(claims)}'`);
    return await fn(c);
  } finally {
    await c.query("rollback");
  }
}

/** Una foto de la visita del mercaderista, con el estado de subida/sello pedido. */
async function sembrarFoto(
  c: Client,
  id: string,
  opciones?: { subidaAt?: string | null; verificadaAt?: string | null },
): Promise<void> {
  await c.query(
    `insert into public.foto
       (id, tenant_id, visita_id, levantamiento_id, tipo, hash, capturada_at, subida_at, verificada_at)
     values ($1::uuid, $2, $3, $4, 'campo_extra', 'sha-' || $1::text, now(), $5, $6)`,
    [
      id,
      TENANTS.maracumango,
      IDS.visitaMrc,
      IDS.levantamientoMrc,
      opciones?.subidaAt ?? null,
      opciones?.verificadaAt ?? null,
    ],
  );
}

/** Espera que la consulta falle con ese mensaje SIN abortar la transacción del
 * test (savepoint): así un mismo test encadena varios rechazos. */
async function debeFallar(
  c: Client,
  sql: string,
  params: unknown[],
  patron: RegExp,
): Promise<void> {
  await c.query("savepoint intento");
  try {
    await c.query(sql, params);
    throw new Error("la consulta debía fallar y no falló");
  } catch (e) {
    expect((e as Error).message).toMatch(patron);
  } finally {
    await c.query("rollback to savepoint intento");
  }
}

async function leerFoto(c: Client, id: string) {
  const r = await c.query<{
    verificada_at: Date | null;
    bytes_r2: number | null;
    verificacion_intento_at: Date | null;
  }>(
    `select verificada_at, bytes_r2, verificacion_intento_at
       from public.foto where id = $1`,
    [id],
  );
  return r.rows[0];
}

const INSERT_MERC = `insert into public.foto (id, visita_id, tipo, hash, capturada_at, %COL%)
   values ($1, $2, 'antes', 'sha', now(), %VAL%)`;

describe("foto.verificada_at — solo el servidor la escribe", () => {
  it("el mercaderista NO puede insertar una foto suya con verificada_at, bytes_r2 ni verificacion_intento_at", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      for (const [col, val] of [
        ["verificada_at", "now()"],
        ["bytes_r2", "10"],
        ["verificacion_intento_at", "now()"],
      ]) {
        await debeFallar(
          c,
          INSERT_MERC.replace("%COL%", col!).replace("%VAL%", val!),
          [IDS.fotoNueva, IDS.visitaMrc],
          /sella el servidor/,
        );
      }
    });
  });

  it("el mercaderista NO puede sellar, des-sellar ni tocar bytes_r2 de una foto suya por UPDATE", async () => {
    await sembradoLuegoMercaderista(
      db,
      async (c) => {
        await sembrarFoto(c, IDS.fotoNueva, {
          subidaAt: "2026-08-01T10:00:00Z",
          verificadaAt: "2026-08-01T10:05:00Z",
        });
        await sembrarFoto(c, IDS.fotoNueva2, {
          subidaAt: "2026-08-01T10:00:00Z",
        });
      },
      async (c) => {
        // Sellar una que no lo está.
        await debeFallar(
          c,
          `update public.foto set verificada_at = now() where id = $1`,
          [IDS.fotoNueva2],
          /no se reescribe desde la app/,
        );
        // Des-sellar y mover el tamaño de una que sí.
        await debeFallar(
          c,
          `update public.foto set verificada_at = null where id = $1`,
          [IDS.fotoNueva],
          /no se reescribe desde la app/,
        );
        await debeFallar(
          c,
          `update public.foto set bytes_r2 = 1 where id = $1`,
          [IDS.fotoNueva],
          /no se reescribe desde la app/,
        );
        await debeFallar(
          c,
          `update public.foto set verificacion_intento_at = now() where id = $1`,
          [IDS.fotoNueva],
          /no se reescribe desde la app/,
        );
      },
    );
  });

  it("el upsert de FILA ENTERA de PowerSync (reintento) pasa y CONSERVA el sello", async () => {
    // La regresión que justifica el trigger frente al grant por columna: el
    // conector reenvía todas las columnas del esquema móvil con `on conflict do
    // update`. Como no manda verificada_at, el trigger la ve igual y deja pasar.
    await sembradoLuegoMercaderista(
      db,
      (c) =>
        sembrarFoto(c, IDS.fotoNueva, {
          subidaAt: "2026-08-01T10:00:00Z",
          verificadaAt: "2026-08-01T10:05:00Z",
        }),
      async (c) => {
        const r = await c.query(
          `insert into public.foto
             (id, tenant_id, visita_id, levantamiento_id, tipo, hash, capturada_at, geo, subida_at)
           select id, tenant_id, visita_id, levantamiento_id, tipo, hash, capturada_at, geo, subida_at
             from public.foto where id = $1
           on conflict (id) do update set
             tenant_id = excluded.tenant_id, visita_id = excluded.visita_id,
             levantamiento_id = excluded.levantamiento_id, tipo = excluded.tipo,
             hash = excluded.hash, capturada_at = excluded.capturada_at,
             geo = excluded.geo, subida_at = excluded.subida_at`,
          [IDS.fotoNueva],
        );
        expect(r.rowCount).toBe(1);
        expect(
          (await leerFoto(c, IDS.fotoNueva))?.verificada_at,
        ).not.toBeNull();
      },
    );
  });

  it("el mercaderista sí sigue marcando subida_at (lo único que el móvil actualiza)", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await c.query(
        `insert into public.foto (id, visita_id, tipo, hash, capturada_at)
         values ($1, $2, 'antes', 'sha', now())`,
        [IDS.fotoNueva, IDS.visitaMrc],
      );
      const r = await c.query(
        `update public.foto set subida_at = now() where id = $1`,
        [IDS.fotoNueva],
      );
      expect(r.rowCount).toBe(1);
    });
  });
});

describe("foto — la identidad se congela", () => {
  it("el mercaderista no puede cambiar tipo, levantamiento, hash ni capturada_at de una foto suya", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await c.query(
        `insert into public.foto (id, visita_id, levantamiento_id, tipo, hash, capturada_at)
         values ($1, $2, $3, 'antes', 'sha', now())`,
        [IDS.fotoNueva, IDS.visitaMrc, IDS.levantamientoMrc],
      );
      const casos: Array<[string, RegExp]> = [
        ["tipo = 'despues'", /tipo no se puede cambiar/],
        [
          "levantamiento_id = null",
          /no se mueve de visita ni de levantamiento/,
        ],
        ["hash = 'otro'", /se fijan al capturar/],
        ["capturada_at = now() - interval '1 day'", /se fijan al capturar/],
      ];
      for (const [set, patron] of casos) {
        await debeFallar(
          c,
          `update public.foto set ${set} where id = $1`,
          [IDS.fotoNueva],
          patron,
        );
      }
    });
  });

  it("tampoco puede renombrar el id, cambiar el tenant ni mover la foto a otra visita", async () => {
    // El trigger es BEFORE UPDATE: su rechazo llega antes que la FK y que el
    // WITH CHECK de la política, por eso el mensaje esperado es el suyo.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await c.query(
        `insert into public.foto (id, visita_id, levantamiento_id, tipo, hash, capturada_at)
         values ($1, $2, $3, 'antes', 'sha', now())`,
        [IDS.fotoNueva, IDS.visitaMrc, IDS.levantamientoMrc],
      );
      const casos: Array<[string, RegExp]> = [
        [`id = '${IDS.fotoNueva2}'`, /id no se puede cambiar/],
        [`tenant_id = '${TENANTS.rival}'`, /tenant_id no se puede cambiar/],
        [
          `visita_id = '${IDS.fotoNueva3}'`,
          /no se mueve de visita ni de levantamiento/,
        ],
      ];
      for (const [set, patron] of casos) {
        await debeFallar(
          c,
          `update public.foto set ${set} where id = $1`,
          [IDS.fotoNueva],
          patron,
        );
      }
    });
  });
});

describe("el servidor sí escribe la autenticidad", () => {
  it("service_role inserta con verificada_at y la actualiza directamente (backfill, soporte)", async () => {
    await comoServicio(db, async (c) => {
      // INSERT ya sellado: la rama `tg_op = 'INSERT'` deja pasar al servidor.
      await sembrarFoto(c, IDS.fotoNueva, {
        subidaAt: "2026-08-01T10:00:00Z",
        verificadaAt: "2026-08-01T10:05:00Z",
      });
      expect((await leerFoto(c, IDS.fotoNueva))?.verificada_at).not.toBeNull();

      // UPDATE directo, sin pasar por la RPC.
      const r = await c.query(
        `update public.foto set verificada_at = now(), bytes_r2 = 77 where id = $1`,
        [IDS.fotoNueva],
      );
      expect(r.rowCount).toBe(1);
      expect((await leerFoto(c, IDS.fotoNueva))?.bytes_r2).toBe(77);
    });
  });
});

describe("las RPC del barrido (service_role)", () => {
  it("sellar_fotos_verificadas sella las del lote, es idempotente y devuelve cuántas selló", async () => {
    await comoServicio(db, async (c) => {
      await sembrarFoto(c, IDS.fotoNueva, { subidaAt: "2026-08-01T10:00:00Z" });
      await sembrarFoto(c, IDS.fotoNueva2, {
        subidaAt: "2026-08-01T10:00:00Z",
      });

      const lote = JSON.stringify([
        { foto_id: IDS.fotoNueva, bytes: 1234 },
        { foto_id: IDS.fotoNueva2, bytes: null },
      ]);
      const primera = await c.query<{ n: number }>(
        `select public.sellar_fotos_verificadas($1::jsonb) as n`,
        [lote],
      );
      expect(primera.rows[0]?.n).toBe(2);
      expect((await leerFoto(c, IDS.fotoNueva))?.bytes_r2).toBe(1234);
      expect((await leerFoto(c, IDS.fotoNueva2))?.verificada_at).not.toBeNull();

      const antes = (
        await leerFoto(c, IDS.fotoNueva)
      )?.verificada_at?.getTime();
      const segunda = await c.query<{ n: number }>(
        `select public.sellar_fotos_verificadas($1::jsonb) as n`,
        [lote],
      );
      expect(segunda.rows[0]?.n).toBe(0);
      expect((await leerFoto(c, IDS.fotoNueva))?.verificada_at?.getTime()).toBe(
        antes,
      );
    });
  });

  it("sellar_fotos_verificadas rechaza null, lo que no es un array y un lote por encima del tope", async () => {
    await comoServicio(db, async (c) => {
      await debeFallar(
        c,
        `select public.sellar_fotos_verificadas(null::jsonb)`,
        [],
        /se espera un array/,
      );
      await debeFallar(
        c,
        `select public.sellar_fotos_verificadas('{"a":1}'::jsonb)`,
        [],
        /se espera un array/,
      );
      const gigante = JSON.stringify(
        Array.from({ length: 501 }, () => ({
          foto_id: IDS.fotoNueva,
          bytes: 1,
        })),
      );
      await debeFallar(
        c,
        `select public.sellar_fotos_verificadas($1::jsonb)`,
        [gigante],
        /por encima del tope/,
      );
    });
  });

  it("fotos_pendientes_de_verificacion devuelve solo subidas y sin verificar, la más vieja primero", async () => {
    await comoServicio(db, async (c) => {
      // Sin subir: no entra. Sellada: no entra. Dos subidas: entran, la vieja primero.
      await sembrarFoto(c, IDS.fotoNueva);
      await sembrarFoto(c, IDS.fotoNueva2, {
        subidaAt: "2026-08-02T10:00:00Z",
        verificadaAt: "2026-08-02T10:05:00Z",
      });
      await sembrarFoto(c, IDS.fotoNueva3, {
        subidaAt: "2026-08-03T10:00:00Z",
      });
      await sembrarFoto(c, IDS.fotoNueva4, {
        subidaAt: "2026-08-01T10:00:00Z",
      });

      const r = await c.query<{
        id: string;
        tenant_id: string;
        visita_id: string;
      }>(
        `select id, tenant_id, visita_id from public.fotos_pendientes_de_verificacion(500)
          where id = any($1::uuid[])`,
        [[IDS.fotoNueva, IDS.fotoNueva2, IDS.fotoNueva3, IDS.fotoNueva4]],
      );
      expect(r.rows.map((x) => x.id)).toEqual([IDS.fotoNueva4, IDS.fotoNueva3]);
      expect(r.rows[0]?.tenant_id).toBe(TENANTS.maracumango);
      expect(r.rows[0]?.visita_id).toBe(IDS.visitaMrc);
    });
  });

  it("fotos_pendientes_de_verificacion respeta el límite pedido", async () => {
    await comoServicio(db, async (c) => {
      await sembrarFoto(c, IDS.fotoNueva, { subidaAt: "2026-08-01T10:00:00Z" });
      await sembrarFoto(c, IDS.fotoNueva2, {
        subidaAt: "2026-08-01T11:00:00Z",
      });
      const r = await c.query<{ n: string }>(
        `select count(*)::text as n from public.fotos_pendientes_de_verificacion(1)`,
      );
      expect(r.rows[0]?.n).toBe("1");
    });
  });

  it("fotos_pendientes_de_verificacion: sin argumento reclama 100, y por encima de 500 se acota a 500", async () => {
    await comoServicio(db, async (c) => {
      // 520 fotos subidas y sin verificar, sembradas de una vez.
      await c.query(
        `insert into public.foto (id, tenant_id, visita_id, levantamiento_id, tipo, hash, capturada_at, subida_at)
         select gen_random_uuid(), $1, $2, $3, 'campo_extra', 'sha-' || g, now(),
                timestamptz '2026-08-01T00:00:00Z' + (g || ' minutes')::interval
           from generate_series(1, 520) g`,
        [TENANTS.maracumango, IDS.visitaMrc, IDS.levantamientoMrc],
      );
      const porDefecto = await c.query<{ n: string }>(
        `select count(*)::text as n from public.fotos_pendientes_de_verificacion()`,
      );
      expect(porDefecto.rows[0]?.n).toBe("100");
      // Las 100 ya reclamadas no vuelven a salir; quedan 420 y se pide 600.
      const acotado = await c.query<{ n: string }>(
        `select count(*)::text as n from public.fotos_pendientes_de_verificacion(600)`,
      );
      expect(acotado.rows[0]?.n).toBe("420");
    });
    await comoServicio(db, async (c) => {
      await c.query(
        `insert into public.foto (id, tenant_id, visita_id, levantamiento_id, tipo, hash, capturada_at, subida_at)
         select gen_random_uuid(), $1, $2, $3, 'campo_extra', 'sha-' || g, now(), now()
           from generate_series(1, 520) g`,
        [TENANTS.maracumango, IDS.visitaMrc, IDS.levantamientoMrc],
      );
      const acotado = await c.query<{ n: string }>(
        `select count(*)::text as n from public.fotos_pendientes_de_verificacion(600)`,
      );
      expect(acotado.rows[0]?.n).toBe("500");
    });
  });

  it("fotos_pendientes_de_verificacion RECLAMA el lote: estampa el intento y no repite lo recién intentado", async () => {
    await comoServicio(db, async (c) => {
      await sembrarFoto(c, IDS.fotoNueva, { subidaAt: "2026-08-01T10:00:00Z" });

      const primera = await c.query<{ id: string }>(
        `select id from public.fotos_pendientes_de_verificacion(500) where id = $1`,
        [IDS.fotoNueva],
      );
      expect(primera.rows).toHaveLength(1);
      expect(
        (await leerFoto(c, IDS.fotoNueva))?.verificacion_intento_at,
      ).not.toBeNull();

      // Un segundo barrido dentro de la hora no la vuelve a coger: un 404
      // permanente no bloquea la cabeza de la cola.
      const segunda = await c.query<{ id: string }>(
        `select id from public.fotos_pendientes_de_verificacion(500) where id = $1`,
        [IDS.fotoNueva],
      );
      expect(segunda.rows).toHaveLength(0);
    });
  });

  it("solo service_role puede ejecutar las dos RPC", async () => {
    const r = await db.query<{
      rol: string;
      listar: boolean;
      sellar: boolean;
    }>(`
      select r.rol,
             has_function_privilege(r.rol, 'public.fotos_pendientes_de_verificacion(integer)', 'execute') as listar,
             has_function_privilege(r.rol, 'public.sellar_fotos_verificadas(jsonb)', 'execute') as sellar
      from (values ('anon'), ('authenticated'), ('service_role')) as r(rol)
    `);
    const porRol = Object.fromEntries(r.rows.map((x) => [x.rol, x]));
    expect(porRol.anon?.listar).toBe(false);
    expect(porRol.anon?.sellar).toBe(false);
    expect(porRol.authenticated?.listar).toBe(false);
    expect(porRol.authenticated?.sellar).toBe(false);
    expect(porRol.service_role?.listar).toBe(true);
    expect(porRol.service_role?.sellar).toBe(true);
  });
});

describe("el barrido programado", () => {
  it("existe el job de pg_cron con su cadencia", async () => {
    const r = await db.query<{
      schedule: string;
      command: string;
      active: boolean;
    }>(
      `select schedule, command, active from cron.job where jobname = 'barrer_fotos_sin_verificar'`,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.schedule).toBe("*/5 * * * *");
    expect(r.rows[0]?.command).toContain("app.barrer_fotos_sin_verificar()");
    expect(r.rows[0]?.active).toBe(true);
  });

  it("con la URL configurada encola la llamada a fotos-verificar; sin ella es no-op", async () => {
    const encoladas = async () => {
      const r = await db.query<{ n: string }>(
        "select count(*)::text as n from net.http_request_queue where url like '%fotos-verificar%'",
      );
      return Number(r.rows[0]?.n ?? "0");
    };
    await db.query("begin");
    try {
      const antes = await encoladas();
      await db.query("select app.barrer_fotos_sin_verificar()");
      expect(await encoladas()).toBe(antes);

      await db.query(
        "select set_config('app.settings.functions_url', 'http://localhost:9999/functions/v1', true)",
      );
      await db.query("select app.barrer_fotos_sin_verificar()");
      expect(await encoladas()).toBe(antes + 1);
    } finally {
      await db.query("rollback");
    }
  });
});
