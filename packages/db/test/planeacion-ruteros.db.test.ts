import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// El diseño de ruteros: reordenar, añadir paradas y duplicar un periodo. Todo
// derivado o transaccional vive en la base, así que se prueba contra la base.

const RUTERO_MRC = "a0000008-0000-0000-0000-000000000001";
const TIENDA_MRC = "a0000002-0000-0000-0000-000000000001";

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

/** Los ids de las paradas de un rutero, en su orden actual. */
async function ordenActual(c: Client, ruteroId: string): Promise<string[]> {
  const r = await c.query<{ id: string }>(
    `select id from public.rutero_parada where rutero_id = $1 order by orden`,
    [ruteroId],
  );
  return r.rows.map((x) => x.id);
}

/** Deja el rutero del seed con tres paradas y devuelve sus ids en orden. */
async function conTresParadas(c: Client): Promise<string[]> {
  await c.query("set local role postgres");
  await c.query(
    `insert into public.rutero_parada (tenant_id, rutero_id, tienda_id, orden)
     select $1, $2, $3, coalesce(max(orden),0) + generate_series(1,2)
     from public.rutero_parada where rutero_id = $2`,
    [TENANTS.maracumango, RUTERO_MRC, TIENDA_MRC],
  );
  await c.query("set local role authenticated");
  return ordenActual(c, RUTERO_MRC);
}

describe("reordenar_paradas", () => {
  it("invierte el orden sin chocar con la unique", async () => {
    // `unique (rutero_id, orden)` se comprueba fila a fila: intercambiar dos
    // paradas la viola a mitad de camino aunque el estado final sea válido. La
    // función difiere la comprobación al final de la transacción.
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const antes = await conTresParadas(c);
      expect(antes).toHaveLength(3);

      await c.query(`select public.reordenar_paradas($1, $2::uuid[])`, [
        RUTERO_MRC,
        [...antes].reverse(),
      ]);

      expect(await ordenActual(c, RUTERO_MRC)).toEqual([...antes].reverse());
    });
  });

  it("renumera 1..n sin huecos", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const ids = await conTresParadas(c);
      await c.query(`select public.reordenar_paradas($1, $2::uuid[])`, [
        RUTERO_MRC,
        [ids[2], ids[0], ids[1]],
      ]);
      const r = await c.query<{ orden: number }>(
        `select orden from public.rutero_parada where rutero_id = $1 order by orden`,
        [RUTERO_MRC],
      );
      expect(r.rows.map((x) => x.orden)).toEqual([1, 2, 3]);
    });
  });

  it("rechaza una lista incompleta en vez de dejar huecos", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const ids = await conTresParadas(c);
      await expect(
        c.query(`select public.reordenar_paradas($1, $2::uuid[])`, [
          RUTERO_MRC,
          [ids[0], ids[1]],
        ]),
      ).rejects.toThrow(/todas las paradas/);
    });
  });

  it("rechaza una lista con un id repetido, aunque mida lo que debe", async () => {
    // `[a,a,c]` sobre {a,b,c} mide 3 igual que la lista buena: comparar solo el
    // tamaño la daría por válida y dejaría a `b` sin renumerar.
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const ids = await conTresParadas(c);
      await expect(
        c.query(`select public.reordenar_paradas($1, $2::uuid[])`, [
          RUTERO_MRC,
          [ids[0], ids[0], ids[2]],
        ]),
      ).rejects.toThrow(/una sola vez/);
    });
  });

  it("no escribe nada cuando rechaza la lista", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const antes = await conTresParadas(c);
      // El `raise exception` aborta la transacción del test: sin el savepoint no
      // se puede consultar después para comprobar que no escribió nada.
      await c.query("savepoint intento");
      await c
        .query(`select public.reordenar_paradas($1, $2::uuid[])`, [
          RUTERO_MRC,
          [antes[2], antes[0]],
        ])
        .catch(() => undefined);
      await c.query("rollback to savepoint intento");

      expect(await ordenActual(c, RUTERO_MRC)).toEqual(antes);
    });
  });

  it("no replanifica un rutero que ya salió del borrador", async () => {
    // El mercaderista está en la calle con él y ya lo tiene replicado.
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const ids = await conTresParadas(c);
      await c.query("set local role postgres");
      await c.query(
        `update public.rutero set estado = 'en_curso' where id = $1`,
        [RUTERO_MRC],
      );
      await c.query("set local role authenticated");

      await expect(
        c.query(`select public.reordenar_paradas($1, $2::uuid[])`, [
          RUTERO_MRC,
          [...ids].reverse(),
        ]),
      ).rejects.toThrow(/borrador/);
    });
  });
});

describe("la planeación solo se toca en borrador", () => {
  // La regla vive en un trigger y no solo en las funciones: `quitarParada` del
  // panel borra por PostgREST, y `parada_staff_escribe` deja a cualquier sesión de
  // staff escribir la tabla directamente.

  async function conRuteroEnEstado(
    c: Client,
    estado: string,
  ): Promise<string[]> {
    const ids = await conTresParadas(c);
    await c.query("set local role postgres");
    await c.query(`update public.rutero set estado = $2 where id = $1`, [
      RUTERO_MRC,
      estado,
    ]);
    await c.query("set local role authenticated");
    return ids;
  }

  it("un supervisor no puede BORRAR una parada de un rutero en curso", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const ids = await conRuteroEnEstado(c, "en_curso");
      await expect(
        c.query(`delete from public.rutero_parada where id = $1`, [ids[0]]),
      ).rejects.toThrow(/ya salió del borrador/);
    });
  });

  it("tampoco puede colgarle una tienda nueva", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await conRuteroEnEstado(c, "publicado");
      await expect(
        c.query(
          `insert into public.rutero_parada (tenant_id, rutero_id, tienda_id, orden)
           values ($1, $2, $3, 99)`,
          [TENANTS.maracumango, RUTERO_MRC, TIENDA_MRC],
        ),
      ).rejects.toThrow(/ya salió del borrador/);
    });
  });

  it("tampoco cambiarle el orden a mano", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const ids = await conRuteroEnEstado(c, "en_curso");
      await expect(
        c.query(`update public.rutero_parada set orden = 9 where id = $1`, [
          ids[0],
        ]),
      ).rejects.toThrow(/ya salió del borrador/);
    });
  });

  it("pero el ESTADO de la parada sigue avanzando con la jornada", async () => {
    // Es la columna que se mueve mientras el mercaderista trabaja: congelarla
    // rompería el seguimiento de la visita.
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const ids = await conRuteroEnEstado(c, "en_curso");
      await c.query(
        `update public.rutero_parada set estado = 'completada' where id = $1`,
        [ids[0]],
      );
      const r = await c.query<{ estado: string }>(
        `select estado from public.rutero_parada where id = $1`,
        [ids[0]],
      );
      expect(r.rows[0]?.estado).toBe("completada");
    });
  });

  it("en borrador se sigue pudiendo todo", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const ids = await conRuteroEnEstado(c, "borrador");
      // La última de las tres: la primera es la del seed y ya tiene una visita
      // colgando, que su propia FK protege de cualquier borrado.
      await c.query(`delete from public.rutero_parada where id = $1`, [ids[2]]);
      expect(await ordenActual(c, RUTERO_MRC)).toHaveLength(2);
    });
  });
});

describe("agregar_parada_rutero", () => {
  it("crea el rutero si el día no tiene, y numera desde 1", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const r = await c.query<{ id: string }>(
        `select public.agregar_parada_rutero($1, '2026-12-24'::date, $2) as id`,
        [USUARIOS.mercaderistaMaracumango, TIENDA_MRC],
      );
      expect(r.rows[0]?.id).toBeTruthy();

      const creado = await c.query<{ estado: string; orden: number }>(
        `select ru.estado, rp.orden
         from public.rutero ru join public.rutero_parada rp on rp.rutero_id = ru.id
         where ru.mercaderista_id = $1 and ru.fecha = '2026-12-24'`,
        [USUARIOS.mercaderistaMaracumango],
      );
      // Nace en borrador: planificar no es publicar.
      expect(creado.rows[0]).toMatchObject({ estado: "borrador", orden: 1 });
    });
  });

  it("no le cuelga tiendas a un día que ya salió del borrador", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const fecha = await c.query<{ fecha: string }>(
        `select to_char(fecha,'YYYY-MM-DD') as fecha from public.rutero where id = $1`,
        [RUTERO_MRC],
      );
      await c.query("set local role postgres");
      await c.query(
        `update public.rutero set estado = 'en_curso' where id = $1`,
        [RUTERO_MRC],
      );
      await c.query("set local role authenticated");

      await expect(
        c.query(`select public.agregar_parada_rutero($1, $2::date, $3)`, [
          USUARIOS.mercaderistaMaracumango,
          fecha.rows[0]?.fecha,
          TIENDA_MRC,
        ]),
      ).rejects.toThrow(/publicado o en curso/);
    });
  });

  it("añade al final del rutero que ya existe", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await conTresParadas(c);
      const fecha = await c.query<{ fecha: string }>(
        `select to_char(fecha,'YYYY-MM-DD') as fecha from public.rutero where id = $1`,
        [RUTERO_MRC],
      );
      await c.query(`select public.agregar_parada_rutero($1, $2::date, $3)`, [
        USUARIOS.mercaderistaMaracumango,
        fecha.rows[0]?.fecha,
        TIENDA_MRC,
      ]);
      const r = await c.query<{ n: string; maximo: number }>(
        `select count(*)::text as n, max(orden) as maximo
         from public.rutero_parada where rutero_id = $1`,
        [RUTERO_MRC],
      );
      expect(Number(r.rows[0]?.n)).toBe(4);
      expect(r.rows[0]?.maximo).toBe(4);
    });
  });

  it("un mercaderista inexistente no crea nada", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await expect(
        c.query(
          `select public.agregar_parada_rutero($1, '2026-12-25'::date, $2)`,
          ["aaaa0000-0000-0000-0000-00000000ffff", TIENDA_MRC],
        ),
      ).rejects.toThrow(/no existe/);
    });
  });
});

describe("duplicar_periodo_rutero", () => {
  it("copia las paradas al periodo siguiente, siempre como borrador", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await c.query("set local role postgres");
      // El rutero de origen se publica: duplicar no debe arrastrar ese estado.
      await c.query(
        `update public.rutero set estado = 'publicado' where id = $1`,
        [RUTERO_MRC],
      );
      await c.query("set local role authenticated");

      const origen = await c.query<{ fecha: string }>(
        `select to_char(fecha,'YYYY-MM-DD') as fecha from public.rutero where id = $1`,
        [RUTERO_MRC],
      );
      const fecha = origen.rows[0]?.fecha ?? "";

      await c.query(
        `select public.duplicar_periodo_rutero($1, $2::date, $2::date, 7)`,
        [USUARIOS.mercaderistaMaracumango, fecha],
      );

      const copia = await c.query<{ estado: string; paradas: string }>(
        `select ru.estado, count(rp.id)::text as paradas
         from public.rutero ru left join public.rutero_parada rp on rp.rutero_id = ru.id
         where ru.mercaderista_id = $1 and ru.fecha = ($2::date + 7)
         group by ru.estado`,
        [USUARIOS.mercaderistaMaracumango, fecha],
      );
      expect(copia.rows[0]?.estado).toBe("borrador");
      expect(Number(copia.rows[0]?.paradas)).toBeGreaterThan(0);
    });
  });

  it("no pisa un día que ya tiene rutero: se puede repetir sin miedo", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const origen = await c.query<{ fecha: string }>(
        `select to_char(fecha,'YYYY-MM-DD') as fecha from public.rutero where id = $1`,
        [RUTERO_MRC],
      );
      const fecha = origen.rows[0]?.fecha ?? "";

      await c.query(
        `select public.duplicar_periodo_rutero($1, $2::date, $2::date, 7)`,
        [USUARIOS.mercaderistaMaracumango, fecha],
      );
      const primera = await c.query<{ n: string }>(
        `select count(*)::text as n from public.rutero_parada rp
         join public.rutero ru on ru.id = rp.rutero_id
         where ru.mercaderista_id = $1 and ru.fecha = ($2::date + 7)`,
        [USUARIOS.mercaderistaMaracumango, fecha],
      );

      // Segunda pasada: el día destino ya existe, así que no debe duplicarse.
      await c.query(
        `select public.duplicar_periodo_rutero($1, $2::date, $2::date, 7)`,
        [USUARIOS.mercaderistaMaracumango, fecha],
      );
      const segunda = await c.query<{ n: string }>(
        `select count(*)::text as n from public.rutero_parada rp
         join public.rutero ru on ru.id = rp.rutero_id
         where ru.mercaderista_id = $1 and ru.fecha = ($2::date + 7)`,
        [USUARIOS.mercaderistaMaracumango, fecha],
      );
      expect(segunda.rows[0]?.n).toBe(primera.rows[0]?.n);
    });
  });

  it("un desplazamiento de cero se rechaza: copiaría sobre sí mismo", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await expect(
        c.query(
          `select public.duplicar_periodo_rutero($1, '2026-08-03'::date, '2026-08-09'::date, 0)`,
          [USUARIOS.mercaderistaMaracumango],
        ),
      ).rejects.toThrow(/cero/);
    });
  });
});

describe("planeacion_ruteros", () => {
  it("devuelve los días del rango con sus paradas", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const fecha = await c.query<{ fecha: string }>(
        `select to_char(fecha,'YYYY-MM-DD') as fecha from public.rutero where id = $1`,
        [RUTERO_MRC],
      );
      const r = await c.query<{ rutero_id: string; tienda_nombre: string }>(
        `select * from public.planeacion_ruteros($1, $2::date, $2::date)`,
        [USUARIOS.mercaderistaMaracumango, fecha.rows[0]?.fecha],
      );
      expect(r.rows.length).toBeGreaterThan(0);
      expect(r.rows[0]?.tienda_nombre).toBeTruthy();
    });
  });

  it("el mercaderista no ve la planeación de un compañero", async () => {
    // La RLS de `rutero` solo le deja la suya; la función es security invoker.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const r = await c.query(
        `select * from public.planeacion_ruteros($1, '2020-01-01'::date, '2030-01-01'::date)`,
        [USUARIOS.mercaderistaRival],
      );
      expect(r.rows).toEqual([]);
    });
  });
});
