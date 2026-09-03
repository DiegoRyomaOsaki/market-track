import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// El diseño de ruteros: reordenar, añadir paradas y duplicar un periodo. Todo
// derivado o transaccional vive en la base, así que se prueba contra la base.

const RUTERO_MRC = "a0000008-0000-0000-0000-000000000001";
const TIENDA_MRC = "a0000002-0000-0000-0000-000000000001";
/** La única parada del seed, y la que tiene una `visita` colgando. */
const PARADA_CON_VISITA = "a0000009-0000-0000-0000-000000000001";

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

// ---------------------------------------------------------------------------
// Corregir un rutero YA PUBLICADO
//
// La ventana que abre MAR-129 es estrecha a propósito: quitar y reordenar, solo
// en `publicado`, solo si la parada no tiene visita y solo si el día no pasó.
// Estos tests fijan las CUATRO esquinas del enum, no solo la que se abre — una
// relajación que se pase de frenada no la caza probar únicamente `publicado`.
// ---------------------------------------------------------------------------

/**
 * Monta un rutero PROPIO —con dos paradas y una visita— y devuelve su id.
 *
 * Existe para el test que borra el rutero entero. Hacerlo sobre el del seed
 * tomaba bloqueos exclusivos, vía la cascada, sobre la visita y el levantamiento
 * que ese seed comparte con las demás suites: mientras esta transacción los
 * retenía, cualquier otra que insertara una fila hija de ese `levantamiento`
 * —una `levantamiento_respuesta`, por ejemplo— se quedaba esperando su
 * `FOR KEY SHARE`, y si la otra ya retenía algo de esta cadena, deadlock.
 *
 * `fecha` lejana a propósito: `rutero` tiene `unique (mercaderista_id, fecha)` y
 * `conRutero` mueve la del seed entre ayer, hoy y mañana.
 */
async function conRuteroPropio(
  c: Client,
  estado: EstadoRutero,
): Promise<string> {
  await c.query("set local role postgres");
  const rutero = await c.query<{ id: string }>(
    `insert into public.rutero (tenant_id, mercaderista_id, fecha, estado)
     values ($1, $2, app.hoy_lima() + 300, 'borrador')
     returning id`,
    [TENANTS.maracumango, USUARIOS.mercaderistaMaracumango],
  );
  const ruteroId = rutero.rows[0]!.id;

  const paradas = await c.query<{ id: string }>(
    `insert into public.rutero_parada (tenant_id, rutero_id, tienda_id, orden)
     values ($1, $2, $3, 1), ($1, $2, $3, 2)
     returning id`,
    [TENANTS.maracumango, ruteroId, TIENDA_MRC],
  );
  // Una visita colgando, como la tiene la parada del seed: es lo que hace que el
  // borrado del rutero tenga que quitarla primero (`visita_parada_fk` es
  // `on delete restrict`), que es justo el camino que este test recorre.
  await c.query(
    `insert into public.visita
       (tenant_id, rutero_parada_id, mercaderista_id, tienda_id, estado, check_in_at)
     values ($1, $2, $3, $4, 'en_curso', now())`,
    [
      TENANTS.maracumango,
      paradas.rows[0]!.id,
      USUARIOS.mercaderistaMaracumango,
      TIENDA_MRC,
    ],
  );

  // El estado se pone al final: el trigger de replanificación no deja tocar las
  // paradas de un rutero que ya salió del borrador.
  await c.query(
    `update public.rutero set estado = $1::public.estado_rutero where id = $2`,
    [estado, ruteroId],
  );
  await c.query("set local role authenticated");
  return ruteroId;
}

const ESTADOS = ["borrador", "publicado", "en_curso", "completado"] as const;
type EstadoRutero = (typeof ESTADOS)[number];

/** Pone el rutero del seed en un estado y una fecha concretos. */
async function conRutero(
  c: Client,
  estado: EstadoRutero,
  fecha: "hoy" | "ayer" | "manana" = "hoy",
): Promise<void> {
  const desplazamiento = { hoy: 0, ayer: -1, manana: 1 }[fecha];
  await c.query("set local role postgres");
  await c.query(
    `update public.rutero
        set estado = $1::public.estado_rutero,
            fecha = app.hoy_lima() + $2::integer
      where id = $3`,
    [estado, desplazamiento, RUTERO_MRC],
  );
  await c.query("set local role authenticated");
}

/** El SQLSTATE de una sentencia que debe fallar, sin abortar la transacción. */
async function codigoDeError(c: Client, sql: string, params: unknown[] = []) {
  await c.query("savepoint intento");
  try {
    await c.query(sql, params);
    await c.query("release savepoint intento");
    return "";
  } catch (err) {
    await c.query("rollback to savepoint intento");
    return (err as { code?: string }).code ?? "";
  }
}

/** Una parada SIN visita del rutero del seed. `conTresParadas` añade dos. */
async function paradaLibre(c: Client): Promise<string> {
  const ids = await conTresParadas(c);
  // La primera del seed es la que tiene visita; las añadidas, no.
  return ids[ids.length - 1]!;
}

describe("el trigger de planeación, en los cuatro estados", () => {
  it.each(ESTADOS)("un DELETE directo en %s", async (estado) => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const parada = await paradaLibre(c);
      await conRutero(c, estado);

      const codigo = await codigoDeError(
        c,
        `delete from public.rutero_parada where id = $1`,
        [parada],
      );

      // La ventana nueva: borrador y publicado sí; el día arrancado, no.
      const permitido = estado === "borrador" || estado === "publicado";
      expect(codigo).toBe(permitido ? "" : "55000");
    });
  });

  it.each(ESTADOS)("mover el `orden` de una parada en %s", async (estado) => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const parada = await paradaLibre(c);
      await conRutero(c, estado);

      const codigo = await codigoDeError(
        c,
        `update public.rutero_parada set orden = orden + 10 where id = $1`,
        [parada],
      );

      const permitido = estado === "borrador" || estado === "publicado";
      expect(codigo).toBe(permitido ? "" : "55000");
    });
  });

  it.each(ESTADOS)(
    "la hora y el estado de la parada pasan en %s",
    async (estado) => {
      // La salida temprana del trigger: `estado` avanza con la jornada y la hora
      // tiene su propia RPC con su propia regla. Relajar el resto no la rompió.
      await comoUsuario(db, USUARIOS.supervisor, async (c) => {
        const parada = await paradaLibre(c);
        await conRutero(c, estado);

        expect(
          await codigoDeError(
            c,
            `update public.rutero_parada set hora_planificada = '08:30' where id = $1`,
            [parada],
          ),
        ).toBe("");
        expect(
          await codigoDeError(
            c,
            `update public.rutero_parada set estado = 'completada' where id = $1`,
            [parada],
          ),
        ).toBe("");
      });
    },
  );

  it("añadir una tienda a un rutero PUBLICADO se sigue rechazando", async () => {
    // Es el caso simétrico y no se pidió: la relajación no puede llevárselo por
    // delante sin que nadie lo note.
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await conRutero(c, "publicado");
      const codigo = await codigoDeError(
        c,
        `insert into public.rutero_parada (tenant_id, rutero_id, tienda_id, orden)
         values ($1, $2, $3, 99)`,
        [TENANTS.maracumango, RUTERO_MRC, TIENDA_MRC],
      );
      expect(codigo).toBe("55000");
    });
  });

  it("cambiarle la TIENDA a una parada de un rutero publicado se rechaza", async () => {
    // Sustituiría el destino sin dejar rastro, que es justo lo que la auditoría
    // del retiro viene a evitar.
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const parada = await paradaLibre(c);
      await conRutero(c, "publicado");
      const codigo = await codigoDeError(
        c,
        `update public.rutero_parada set tienda_id = $1 where id = $2`,
        ["a0000002-0000-0000-0000-000000000002", parada],
      );
      expect(codigo).toBe("55000");
    });
  });

  it.each(["publicado", "en_curso"] as const)(
    "borrar el rutero ENTERO sigue cascadeando en %s",
    async (estado) => {
      // La salida de la cascada del trigger («sin fila padre no es replanificar»)
      // era una rama viva SIN cobertura: si la relajación la hubiera roto, la
      // única salida que hoy tiene el supervisor habría dejado de funcionar.
      await comoUsuario(db, USUARIOS.supervisor, async (c) => {
        // Sobre un rutero PROPIO, no el del seed: borrarlo entero toma bloqueos
        // exclusivos por cascada sobre la visita y el levantamiento que el seed
        // comparte con las demás suites, y eso deadlockeaba de forma
        // intermitente contra quien insertara una fila hija de ese
        // levantamiento.
        const ruteroId = await conRuteroPropio(c, estado);
        await c.query("set local role postgres");
        // La visita se quita primero, y eso ES el hallazgo: `visita_parada_fk`
        // (`on delete restrict`) corta también la CASCADA del rutero entero. O
        // sea que la única salida que hoy tiene el supervisor —tirar el día—
        // deja de funcionar en cuanto alguien ficha. Aquí se prueba la salida
        // del trigger, que es otra cosa; la verja de la FK tiene su test aparte.
        await c.query(
          `delete from public.visita where rutero_parada_id in
          (select id from public.rutero_parada where rutero_id = $1)`,
          [ruteroId],
        );
        await c.query(`delete from public.rutero where id = $1`, [ruteroId]);
        await c.query("set local role authenticated");

        const r = await c.query<{ n: string }>(
          `select count(*) as n from public.rutero_parada where rutero_id = $1`,
          [ruteroId],
        );
        expect(Number(r.rows[0]!.n)).toBe(0);
      });
    },
  );
});

describe("quitar_parada_rutero", () => {
  async function quitar(c: Client, parada: string, motivo?: string) {
    return codigoDeError(c, `select public.quitar_parada_rutero($1, $2)`, [
      parada,
      motivo ?? null,
    ]);
  }

  type FilaRetirada = {
    rutero_id: string;
    tienda_id: string;
    orden: number;
    estado_rutero: string;
    retirada_por: string;
    motivo: string | null;
    fecha: Date;
  };

  async function auditoria(c: Client): Promise<FilaRetirada[]> {
    const r = await c.query<FilaRetirada>(
      `select rutero_id, tienda_id, orden, estado_rutero, retirada_por, motivo, fecha
         from public.rutero_parada_retirada where rutero_id = $1`,
      [RUTERO_MRC],
    );
    return r.rows;
  }

  it.each(ESTADOS)("quitar en %s respeta la ventana", async (estado) => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const parada = await paradaLibre(c);
      await conRutero(c, estado);

      const codigo = await quitar(c, parada);
      const permitido = estado === "borrador" || estado === "publicado";
      expect(codigo).toBe(permitido ? "" : "55000");
    });
  });

  it("una parada con VISITA no se quita, ni siquiera en borrador", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await conRutero(c, "borrador");
      // La parada del seed es la que tiene visita colgando.
      const codigo = await quitar(c, PARADA_CON_VISITA);
      expect(codigo).toBe("23503");
    });
  });

  it("y cuando rechaza por visita, la parada SIGUE ahí", async () => {
    // Que levante el error no basta: hay que ver que no escribió nada.
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await conRutero(c, "borrador");
      await quitar(c, PARADA_CON_VISITA);

      const r = await c.query<{ n: string }>(
        `select count(*) as n from public.rutero_parada where id = $1`,
        [PARADA_CON_VISITA],
      );
      expect(Number(r.rows[0]!.n)).toBe(1);
    });
  });

  it("un rechazo NO deja rastro de auditoría", async () => {
    // Una auditoría de intentos fallidos mentiría sobre lo que llegó a pasar.
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await conRutero(c, "borrador");
      await quitar(c, PARADA_CON_VISITA);
      expect(await auditoria(c)).toEqual([]);
    });
  });

  it("un día YA PASADO no se toca, aunque el rutero esté publicado", async () => {
    // `rutero.estado` no sale nunca de `publicado`, así que sin este guardarraíl
    // «solo en publicado» incluiría el rutero de hace tres meses — y borrar una
    // parada de un día pasado borra un `falto` de `puntualidad_paradas`, que sube
    // el bono del periodo abierto.
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const parada = await paradaLibre(c);
      await conRutero(c, "publicado", "ayer");
      expect(await quitar(c, parada)).toBe("55000");
    });
  });

  it("el día de MAÑANA sí se puede corregir", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const parada = await paradaLibre(c);
      await conRutero(c, "publicado", "manana");
      expect(await quitar(c, parada)).toBe("");
    });
  });

  it("deja constancia de quién la quitó, de qué rutero y en qué estado", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const parada = await paradaLibre(c);
      const antes = await c.query<{ tienda_id: string; orden: number }>(
        `select tienda_id, orden from public.rutero_parada where id = $1`,
        [parada],
      );
      await conRutero(c, "publicado");

      expect(await quitar(c, parada, "  se duplicó al importar  ")).toBe("");

      const filas = await auditoria(c);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        rutero_id: RUTERO_MRC,
        tienda_id: antes.rows[0]!.tienda_id,
        orden: antes.rows[0]!.orden,
        estado_rutero: "publicado",
        retirada_por: USUARIOS.supervisor,
        // El motivo llega recortado, no tal cual lo escribieron.
        motivo: "se duplicó al importar",
      });
    });
  });

  it("sin motivo, la fila de auditoría se escribe igual con motivo nulo", async () => {
    // El criterio pide saber QUIÉN quitó QUÉ, no por qué: un motivo obligatorio
    // que nadie pidió solo produciría motivos de relleno.
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const parada = await paradaLibre(c);
      await conRutero(c, "publicado");
      expect(await quitar(c, parada)).toBe("");

      const filas = await auditoria(c);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ motivo: null });
    });
  });

  it("una cadena en blanco como motivo se guarda como nulo, no como espacios", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const parada = await paradaLibre(c);
      await conRutero(c, "publicado");
      expect(await quitar(c, parada, "   ")).toBe("");
      expect((await auditoria(c))[0]).toMatchObject({ motivo: null });
    });
  });

  it("una parada que ya no existe se distingue de un rechazo", async () => {
    // El supervisor puede pulsar sobre una fila que otro ya quitó: el mensaje
    // «recarga la pantalla» no es el mismo que «no se puede».
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      expect(await quitar(c, "e9000000-0000-0000-0000-000000000000")).toBe(
        "P0002",
      );
    });
  });

  it("el mercaderista no quita paradas de su propia ruta", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      expect(await quitar(c, PARADA_CON_VISITA)).toBe("42501");
    });
  });

  it("el mercaderista no lee el rastro de auditoría", async () => {
    // Es un dato de gestión: quién le movió la ruta y por qué lo mira el staff.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const r = await c.query<{ n: string }>(
        `select count(*) as n from public.rutero_parada_retirada`,
      );
      expect(Number(r.rows[0]!.n)).toBe(0);
    });
  });

  it("tras quitar, reordenar cierra el hueco que dejó", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const ids = await conTresParadas(c);
      await conRutero(c, "publicado");
      expect(await quitar(c, ids[1]!)).toBe("");

      const quedan = await ordenActual(c, RUTERO_MRC);
      await c.query(`select public.reordenar_paradas($1, $2::uuid[])`, [
        RUTERO_MRC,
        quedan,
      ]);

      const r = await c.query<{ orden: number }>(
        `select orden from public.rutero_parada where rutero_id = $1 order by orden`,
        [RUTERO_MRC],
      );
      expect(r.rows.map((x) => x.orden)).toEqual([1, 2]);
    });
  });
});

describe("reordenar_paradas fuera del borrador", () => {
  it.each(ESTADOS)("reordenar en %s respeta la ventana", async (estado) => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const ids = await conTresParadas(c);
      await conRutero(c, estado);

      const codigo = await codigoDeError(
        c,
        `select public.reordenar_paradas($1, $2::uuid[])`,
        [RUTERO_MRC, [...ids].reverse()],
      );

      const permitido = estado === "borrador" || estado === "publicado";
      expect(codigo).toBe(permitido ? "" : "55000");
    });
  });
});

describe("planeacion_ruteros.tiene_visita", () => {
  it("distingue la parada con visita de la que no la tiene", async () => {
    // Es lo que deja al panel inhabilitar "Eliminar" CON SU MOTIVO en vez de
    // esconderlo. Sale de `visita`, no de `rutero_parada.estado`: esa columna no
    // la escribe nadie, así que daría `pendiente` siempre.
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const ids = await conTresParadas(c);
      const r = await c.query<{ parada_id: string; tiene_visita: boolean }>(
        `select parada_id, tiene_visita
           from public.planeacion_ruteros($1, '2026-01-01', '2027-12-31')
          where parada_id is not null`,
        [USUARIOS.mercaderistaMaracumango],
      );
      const porId = new Map(r.rows.map((x) => [x.parada_id, x.tiene_visita]));

      expect(porId.get(PARADA_CON_VISITA)).toBe(true);
      for (const id of ids.filter((x) => x !== PARADA_CON_VISITA)) {
        expect(porId.get(id)).toBe(false);
      }
    });
  });

  it("un día con rutero y CERO paradas no inventa un `tiene_visita` verdadero", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await c.query("set local role postgres");
      await c.query(
        `delete from public.visita where rutero_parada_id is not null`,
      );
      await c.query(`delete from public.rutero_parada where rutero_id = $1`, [
        RUTERO_MRC,
      ]);
      await c.query("set local role authenticated");

      const r = await c.query<{
        parada_id: string | null;
        tiene_visita: boolean;
      }>(
        `select parada_id, tiene_visita
           from public.planeacion_ruteros($1, '2026-01-01', '2027-12-31')`,
        [USUARIOS.mercaderistaMaracumango],
      );
      const vacio = r.rows.find((x) => x.parada_id === null);
      expect(vacio).toBeDefined();
      expect(vacio?.tiene_visita).toBe(false);
    });
  });
});

describe("una parada no se muda de rutero", () => {
  // El agujero que este PR cierra, y que venía de antes: el trigger resuelve el
  // estado con `coalesce(new.rutero_id, old.rutero_id)`, que en un UPDATE es
  // siempre el rutero de DESTINO. Bastaba con apuntar la parada a un rutero en
  // borrador para sacarla de uno `completado` sin auditoría, sin la verja de la
  // visita y sin la del día pasado. Verificado en vivo antes de escribir la
  // guarda.
  it.each(["borrador", "publicado", "en_curso", "completado"] as const)(
    "mover una parada desde un rutero en %s se rechaza",
    async (estado) => {
      await comoUsuario(db, USUARIOS.supervisor, async (c) => {
        const parada = await paradaLibre(c);
        await conRutero(c, estado);

        await c.query("set local role postgres");
        await c.query(
          `insert into public.rutero (id, tenant_id, mercaderista_id, fecha, estado)
           values ('e1000000-0000-0000-0000-000000000001', $1, $2,
                   app.hoy_lima() + 1, 'borrador')`,
          [TENANTS.maracumango, USUARIOS.mercaderistaMaracumango],
        );
        await c.query("set local role authenticated");

        const codigo = await codigoDeError(
          c,
          `update public.rutero_parada set rutero_id = $1 where id = $2`,
          ["e1000000-0000-0000-0000-000000000001", parada],
        );
        expect(codigo).toBe("55000");
      });
    },
  );
});
