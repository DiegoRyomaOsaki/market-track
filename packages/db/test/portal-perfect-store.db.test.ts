import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// Las tres lecturas que alimentan la sección de Perfect Store del portal: la
// serie (evolución), el desglose por nivel (drill-down) y el filtro por cadena
// que se le añadió al agregado.
//
// Lo que más importa en la serie es que un bucket SIN visitas salga igual, con
// cero levantamientos y puntaje nulo. Si se omitiera, la gráfica uniría dos
// puntos separados por tres semanas como si fueran consecutivos: una caída de
// actividad se leería como una línea estable.

const IDS = {
  marca: "cccccccc-0000-0000-0000-000000000001",
  tienda: "a0000002-0000-0000-0000-000000000001",
  parada: "a0000009-0000-0000-0000-000000000001",
  sku: "a0000003-0000-0000-0000-000000000001",
  cadena: "a0000001-0000-0000-0000-000000000001",
  categoria: "a0000004-0000-0000-0000-000000000001",
  otraCadena: "b0000001-0000-0000-0000-000000000002",
} as const;

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

async function comoOtro<T>(
  c: Client,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const claims = JSON.stringify({
    sub: userId,
    role: "authenticated",
    aal: "aal2",
  });
  await c.query(`set local request.jwt.claims = '${claims}'`);
  try {
    return await fn();
  } finally {
    const admin = JSON.stringify({
      sub: USUARIOS.admin,
      role: "authenticated",
      aal: "aal2",
    });
    await c.query(`set local request.jwt.claims = '${admin}'`);
  }
}

/**
 * Un levantamiento puntuado con fecha controlada.
 *
 * `check_in_recibido_at` la sella un trigger del servidor, así que se fuerza
 * DESPUÉS de crear la visita: es la columna con la que se fecha el puntaje y la
 * que la serie agrupa.
 */
async function puntuarEn(
  c: Client,
  sufijo: string,
  diasAtras: number,
  opciones: { tienda?: string; quiebre?: boolean; instante?: string } = {},
): Promise<void> {
  const visita = `e2000010-0000-0000-0000-0000000000${sufijo}`;
  const lev = `e2000011-0000-0000-0000-0000000000${sufijo}`;
  const tienda = opciones.tienda ?? IDS.tienda;
  const quiebre = opciones.quiebre ?? false;

  await comoOtro(c, USUARIOS.mercaderistaMaracumango, async () => {
    await c.query(
      `insert into public.visita (id, tenant_id, rutero_parada_id, mercaderista_id, tienda_id, estado, check_in_at)
       values ($1, $2, $3, $4, $5, 'en_curso', now())`,
      [
        visita,
        TENANTS.maracumango,
        IDS.parada,
        USUARIOS.mercaderistaMaracumango,
        tienda,
      ],
    );
  });

  // `instante` fija la marca exacta; sin él vale el desplazamiento en días. Hace
  // falta para probar la frontera horaria, que con "hace N días" nunca se cruza.
  await c.query(
    opciones.instante
      ? `update public.visita set check_in_recibido_at = $2::timestamptz where id = $1`
      : `update public.visita set check_in_recibido_at = now() - ($2 || ' days')::interval
         where id = $1`,
    [visita, opciones.instante ?? diasAtras],
  );

  await comoOtro(c, USUARIOS.mercaderistaMaracumango, async () => {
    await c.query(
      `insert into public.levantamiento (id, tenant_id, visita_id, marca_id)
       values ($1, $2, $3, $4)`,
      [lev, TENANTS.maracumango, visita, IDS.marca],
    );
    // `quiebre` es una columna GENERADA (`stock_piso = 0 and stock_sistema > 0`):
    // se provoca con el stock de piso, no se escribe.
    await c.query(
      `insert into public.levantamiento_sku
         (tenant_id, levantamiento_id, sku_id, stock_sistema, stock_piso)
       values ($1, $2, $3, 5, $4)`,
      [TENANTS.maracumango, lev, IDS.sku, quiebre ? 0 : 5],
    );
    await c.query(
      `update public.levantamiento set estado = 'completado' where id = $1`,
      [lev],
    );
  });
}

type Punto = {
  periodo: string;
  levantamientos: string;
  total_pct: string | null;
};

describe("las RPC no las alcanza nadie sin sesión", () => {
  it("anon no puede EJECUTAR ninguna de las tres", async () => {
    // Una función nueva nace con `execute` para PUBLIC: el `revoke` no es una
    // formalidad. Hoy además fallaría cerrado porque `anon` no lee las tablas del
    // join, pero ese candado es prestado — se cae el día que se publique un
    // catálogo. Este test fija el candado propio.
    const r = await db.query<{ proname: string; anon: boolean; pub: boolean }>(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('public', p.oid, 'execute') as pub
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'perfect_store%'
      order by p.proname
    `);

    expect(r.rows.length).toBe(3);
    expect(r.rows.filter((f) => f.anon || f.pub).map((f) => f.proname)).toEqual(
      [],
    );
  });

  it("authenticated sí puede ejecutarlas: el revoke no se pasó de frenada", async () => {
    const r = await db.query<{ proname: string; auth: boolean }>(`
      select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'perfect_store%'
    `);
    expect(r.rows.filter((f) => !f.auth).map((f) => f.proname)).toEqual([]);
  });
});

describe("la serie devuelve todos los buckets del rango", () => {
  it("un bucket SIN visitas sale igual, con cero y puntaje nulo", async () => {
    // El criterio que hace honesta la gráfica: un hueco se ve como un hueco.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await c.query<Punto>(
        `select periodo, levantamientos, total_pct
         from public.perfect_store_serie(
           app.hoy_lima() - 21, app.hoy_lima(), 'semana')`,
      );

      expect(r.rows.length).toBeGreaterThanOrEqual(4);
      expect(r.rows.every((p) => Number(p.levantamientos) === 0)).toBe(true);
      expect(r.rows.every((p) => p.total_pct === null)).toBe(true);
    });
  });

  it("los buckets salen ORDENADOS: una gráfica no puede ir hacia atrás", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await c.query<Punto>(
        `select periodo from public.perfect_store_serie(
           app.hoy_lima() - 60, app.hoy_lima(), 'mes')`,
      );

      // Por TIEMPO, no con el `sort()` por defecto: `pg` devuelve las fechas
      // como objetos Date y el orden por defecto las pasa a texto — "Aug"
      // quedaría antes que "Jul" y el test pasaría con la serie desordenada.
      const fechas = r.rows.map((p) => new Date(p.periodo).getTime());
      expect([...fechas].sort((a, b) => a - b)).toEqual(fechas);
    });
  });

  it("un levantamiento puntuado cae en SU bucket, no en todos", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await puntuarEn(c, "01", 0);

      const r = await c.query<Punto>(
        `select periodo, levantamientos, total_pct
         from public.perfect_store_serie(
           app.hoy_lima() - 21, app.hoy_lima(), 'semana')`,
      );

      const conDatos = r.rows.filter((p) => Number(p.levantamientos) > 0);
      expect(conDatos).toHaveLength(1);
      expect(Number(conDatos[0]?.total_pct)).toBeGreaterThan(0);
    });
  });

  it("dos levantamientos de semanas distintas caen en buckets distintos", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await puntuarEn(c, "02", 0);
      await puntuarEn(c, "03", 14);

      const r = await c.query<Punto>(
        `select periodo, levantamientos from public.perfect_store_serie(
           app.hoy_lima() - 21, app.hoy_lima(), 'semana')`,
      );

      expect(r.rows.filter((p) => Number(p.levantamientos) > 0)).toHaveLength(
        2,
      );
    });
  });

  it("la granularidad mensual agrupa lo que la semanal separa", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await puntuarEn(c, "04", 0);
      await puntuarEn(c, "05", 7);

      const semanal = await c.query<Punto>(
        `select levantamientos from public.perfect_store_serie(
           app.hoy_lima() - 21, app.hoy_lima(), 'semana')`,
      );
      const mensual = await c.query<Punto>(
        `select levantamientos from public.perfect_store_serie(
           app.hoy_lima() - 21, app.hoy_lima(), 'mes')`,
      );

      const conDatos = (rs: Punto[]) =>
        rs.filter((p) => Number(p.levantamientos) > 0).length;
      expect(conDatos(semanal.rows)).toBeGreaterThanOrEqual(
        conDatos(mensual.rows),
      );
    });
  });

  it("una visita de las 20:00 de LIMA cae en el día de Lima, no en el de UTC", async () => {
    // La garantía central de la serie. A las 20:00 de Lima el día UTC ya rodó al
    // siguiente: truncar en UTC movería toda la jornada de cierre de tienda —el
    // turno de la tarde— al periodo de mañana. Con "hace N días" esta frontera
    // no se cruza nunca, por eso el instante va fijado a mano.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // 01:00 UTC del 11 = 20:00 de Lima del 10.
      await puntuarEn(c, "30", 0, { instante: "2026-08-11T01:00:00Z" });

      const r = await c.query<Punto>(
        `select periodo, levantamientos from public.perfect_store_serie(
           '2026-08-09'::date, '2026-08-12'::date, 'dia')`,
      );

      const conDatos = r.rows.filter((p) => Number(p.levantamientos) > 0);
      expect(conDatos).toHaveLength(1);
      expect(new Date(conDatos[0]!.periodo).toISOString().slice(0, 10)).toBe(
        "2026-08-10",
      );
    });
  });

  it("la granularidad diaria da un bucket por día del rango", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await c.query<Punto>(
        `select periodo from public.perfect_store_serie(
           '2026-08-09'::date, '2026-08-12'::date, 'dia')`,
      );
      expect(r.rows).toHaveLength(4);
    });
  });

  it("un rango de un solo día da exactamente un bucket", async () => {
    // Donde viven los off-by-one de `generate_series` y de la ventana [inicio, fin).
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      for (const g of ["dia", "semana", "mes"]) {
        const r = await c.query<Punto>(
          `select periodo from public.perfect_store_serie(
             app.hoy_lima(), app.hoy_lima(), $1::public.granularidad_serie)`,
          [g],
        );
        expect(r.rows, `granularidad ${g}`).toHaveLength(1);
      }
    });
  });

  it("un rango invertido no revienta: devuelve vacío", async () => {
    // Llega desde la URL, que la escribe cualquiera. El comportamiento se fija
    // aquí para que nadie lo "arregle" dando la vuelta al rango en silencio.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await puntuarEn(c, "31", 0);

      const serie = await c.query(
        `select * from public.perfect_store_serie(
           app.hoy_lima(), app.hoy_lima() - 7, 'semana')`,
      );
      const desglose = await c.query(
        `select * from public.perfect_store_desglose(
           app.hoy_lima(), app.hoy_lima() - 7, 'categoria')`,
      );
      const agregado = await c.query<{ levantamientos: string }>(
        `select levantamientos from public.perfect_store_agregado(
           app.hoy_lima(), app.hoy_lima() - 7)`,
      );

      expect(serie.rows).toHaveLength(0);
      expect(desglose.rows).toHaveLength(0);
      // El agregado sí devuelve su fila: es "el puntaje de la selección", y la
      // selección está vacía.
      expect(Number(agregado.rows[0]?.levantamientos)).toBe(0);
    });
  });

  it("el cliente-marca solo ve lo suyo: lo acota la RLS", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await puntuarEn(c, "06", 0);
    });

    await comoUsuario(db, USUARIOS.mercaderistaRival, async (c) => {
      const r = await c.query<Punto>(
        `select levantamientos from public.perfect_store_serie(
           app.hoy_lima() - 21, app.hoy_lima(), 'semana')`,
      );
      expect(r.rows.every((p) => Number(p.levantamientos) === 0)).toBe(true);
    });
  });
});

describe("el agregado filtra por cadena", () => {
  it("la cadena de la tienda incluye el levantamiento", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await puntuarEn(c, "07", 0);

      const r = await c.query<{ levantamientos: string }>(
        `select levantamientos from public.perfect_store_agregado(
           app.hoy_lima() - 7, app.hoy_lima(),
           null, null, null, null, null, $1)`,
        [IDS.cadena],
      );
      expect(Number(r.rows[0]?.levantamientos)).toBe(1);
    });
  });

  it("otra cadena lo excluye", async () => {
    // Es el tercer nivel del drill-down: categoría → tipo de tienda → cadena →
    // tienda. Sin este filtro, ese nivel no existiría.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await puntuarEn(c, "08", 0);

      const r = await c.query<{ levantamientos: string }>(
        `select levantamientos from public.perfect_store_agregado(
           app.hoy_lima() - 7, app.hoy_lima(),
           null, null, null, null, null, $1)`,
        [IDS.otraCadena],
      );
      expect(Number(r.rows[0]?.levantamientos)).toBe(0);
    });
  });

  it("la serie también filtra por cadena", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await puntuarEn(c, "09", 0);

      const r = await c.query<Punto>(
        `select levantamientos from public.perfect_store_serie(
           app.hoy_lima() - 7, app.hoy_lima(), 'semana',
           null, null, null, null, $1)`,
        [IDS.otraCadena],
      );
      expect(r.rows.every((p) => Number(p.levantamientos) === 0)).toBe(true);
    });
  });
});

type FilaDesglose = {
  clave: string;
  etiqueta: string;
  levantamientos: string;
  total_pct: string | null;
  visibilidad_pct: string | null;
};

/** Una segunda tienda en su propia cadena, para que el desglose tenga más de una
 * fila que agrupar. El seed trae una sola por cliente. */
async function segundaTienda(c: Client): Promise<string> {
  const cadena = "e2000020-0000-0000-0000-000000000001";
  const tienda = "e2000021-0000-0000-0000-000000000001";

  await c.query(
    `insert into public.cadena (id, tenant_id, nombre, codigo_externo, tipo_tienda)
     values ($1, $2, 'Metro', 'MET', 'express')`,
    [cadena, TENANTS.maracumango],
  );
  await c.query(
    `insert into public.tienda (id, tenant_id, cadena_id, nombre, codigo_externo, ubicacion)
     values ($1, $2, $3, 'Metro Surco', 'MET-SU',
             'SRID=4326;POINT(-76.99 -12.13)'::extensions.geography)`,
    [tienda, TENANTS.maracumango, cadena],
  );
  await c.query(
    `insert into public.tienda_sku (tenant_id, tienda_id, sku_id) values ($1, $2, $3)`,
    [TENANTS.maracumango, tienda, IDS.sku],
  );
  return tienda;
}

describe("el desglose agrupa por nivel: es el drill-down", () => {
  it("sin datos NO devuelve una fila en cero: no devuelve ninguna", async () => {
    // La diferencia que hace honesta la pantalla. El agregado sí da una fila con
    // count 0 —es "el puntaje de la selección"—; el desglose es una lista, y una
    // lista vacía se lee como "sin datos", no como "todos en cero".
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await c.query<FilaDesglose>(
        `select * from public.perfect_store_desglose(
           app.hoy_lima() - 7, app.hoy_lima(), 'categoria')`,
      );
      expect(r.rows).toHaveLength(0);
    });
  });

  it("por categoría trae la etiqueta y deja la visibilidad NULA", async () => {
    // La visibilidad no se puede partir por categoría: hay una sola medición de
    // share of shelf por visita. Nula, no cero — su peso se renormaliza.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await puntuarEn(c, "20", 0);

      const r = await c.query<FilaDesglose>(
        `select * from public.perfect_store_desglose(
           app.hoy_lima() - 7, app.hoy_lima(), 'categoria')`,
      );

      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.etiqueta).toBe("Bebidas");
      expect(Number(r.rows[0]?.total_pct)).toBeGreaterThan(0);
      expect(r.rows[0]?.visibilidad_pct).toBeNull();
    });
  });

  it("por cadena da una fila por cadena, peor puntaje primero", async () => {
    // El orden es el criterio de uso del tablero: se abre por donde se falla.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const otra = await segundaTienda(c);
      await puntuarEn(c, "21", 0);
      await puntuarEn(c, "22", 0, { tienda: otra, quiebre: true });

      const r = await c.query<FilaDesglose>(
        `select * from public.perfect_store_desglose(
           app.hoy_lima() - 7, app.hoy_lima(), 'cadena')`,
      );

      expect(r.rows.map((f) => f.etiqueta)).toEqual(["Metro", "Plaza Vea"]);
      expect(Number(r.rows[0]?.total_pct)).toBeLessThan(
        Number(r.rows[1]?.total_pct),
      );
    });
  });

  it("por tipo de tienda la clave es el enum, no un uuid", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const otra = await segundaTienda(c); // su cadena sí lleva tipo: 'express'
      await puntuarEn(c, "23", 0, { tienda: otra });

      const r = await c.query<FilaDesglose>(
        `select * from public.perfect_store_desglose(
           app.hoy_lima() - 7, app.hoy_lima(), 'tipo_tienda')`,
      );

      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.clave).toBe("express");
      expect(r.rows[0]?.etiqueta).toBe("express");
    });
  });

  it("una cadena sin tipo sale como grupo NO navegable, no desaparece", async () => {
    // Esconderla haría que el desglose no sumara el número de arriba. Sale con
    // etiqueta propia y sin clave: la fila se lee, pero no se entra en ella.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await puntuarEn(c, "28", 0); // Plaza Vea, que en el seed no lleva tipo

      const r = await c.query<FilaDesglose>(
        `select * from public.perfect_store_desglose(
           app.hoy_lima() - 7, app.hoy_lima(), 'tipo_tienda')`,
      );

      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.clave).toBeNull();
      expect(r.rows[0]?.etiqueta).toBe("Sin clasificar");
      expect(Number(r.rows[0]?.levantamientos)).toBe(1);
    });
  });

  it("un nivel más hondo respeta el filtro del nivel anterior", async () => {
    // Bajar de cadena a tienda es estrechar, no reiniciar: con la cadena puesta,
    // el desglose por tienda solo puede traer tiendas de esa cadena.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const otra = await segundaTienda(c);
      await puntuarEn(c, "24", 0);
      await puntuarEn(c, "25", 0, { tienda: otra });

      const r = await c.query<FilaDesglose>(
        `select * from public.perfect_store_desglose(
           app.hoy_lima() - 7, app.hoy_lima(), 'tienda',
           null, null, null, null, $1)`,
        [IDS.cadena],
      );

      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.etiqueta).toBe("Plaza Vea La Molina");
    });
  });

  it("con una categoría filtrada, el desglose por tienda sale del corte por categoría", async () => {
    // Y por eso su visibilidad va nula también aquí: la fuente es la misma tabla.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await puntuarEn(c, "26", 0);

      const r = await c.query<FilaDesglose>(
        `select * from public.perfect_store_desglose(
           app.hoy_lima() - 7, app.hoy_lima(), 'tienda',
           null, $1)`,
        [IDS.categoria],
      );

      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.visibilidad_pct).toBeNull();
    });
  });

  it("el cliente de otro tenant no ve el desglose ajeno", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await puntuarEn(c, "27", 0);
    });

    await comoUsuario(db, USUARIOS.mercaderistaRival, async (c) => {
      const r = await c.query<FilaDesglose>(
        `select * from public.perfect_store_desglose(
           app.hoy_lima() - 7, app.hoy_lima(), 'cadena')`,
      );
      expect(r.rows).toHaveLength(0);
    });
  });
});
