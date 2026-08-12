import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// Puntualidad y asistencia por parada: los HECHOS de los que saldrá el plan de
// lealtad del mercaderista. El puntaje es de otro ticket; aquí solo se comprueba
// que los hechos son ciertos.
//
// Los dos criterios que de verdad importan:
//   · una parada de HOY todavía sin visitar está pendiente, no faltada;
//   · el corte del día es el de Lima, no el de UTC.

const MERCADERISTA = USUARIOS.mercaderistaMaracumango;
const TIENDA = "a0000002-0000-0000-0000-000000000001";

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

type Fila = {
  parada_id: string;
  fecha: string;
  minutos_desvio: number | null;
  dentro_tolerancia: boolean | null;
  asistencia: "pendiente" | "asistio" | "falto";
};

/**
 * Un rutero con una parada, en la fecha dada y con la hora esperada dada.
 *
 * Se escribe como `postgres` (igual que el resto del arnés de ruteros): el
 * diseño de ruteros es cosa del staff y aquí solo interesa el dato derivado.
 */
async function conParada(
  c: Client,
  sufijo: string,
  // Una EXPRESIÓN SQL, no un valor: los casos interesantes son relativos al día
  // de Lima (`app.hoy_lima() - 1`) y como parámetro no se evaluarían. Son
  // literales del propio test, no entrada de nadie.
  fecha: string,
  hora: string | null,
  estado: "borrador" | "publicado" | "en_curso" | "completado" = "publicado",
): Promise<string> {
  const rutero = `e3000001-0000-0000-0000-0000000000${sufijo}`;
  const parada = `e3000002-0000-0000-0000-0000000000${sufijo}`;

  await c.query("set local role postgres");
  // Se crea en borrador y se publica DESPUÉS: un guard impide tocar las paradas
  // de un rutero que ya salió del borrador.
  await c.query(
    `insert into public.rutero (id, tenant_id, mercaderista_id, fecha)
     values ($1, $2, $3, ${fecha})`,
    [rutero, TENANTS.maracumango, MERCADERISTA],
  );
  await c.query(
    `insert into public.rutero_parada
       (id, tenant_id, rutero_id, tienda_id, orden, hora_planificada)
     values ($1, $2, $3, $4, 1, $5)`,
    [parada, TENANTS.maracumango, rutero, TIENDA, hora],
  );
  await c.query(`update public.rutero set estado = $2 where id = $1`, [
    rutero,
    estado,
  ]);
  await c.query("set local role authenticated");
  return parada;
}

/** Un check-in en un instante exacto sobre esa parada. */
async function llegaA(
  c: Client,
  parada: string,
  sufijo: string,
  // También una expresión SQL, por lo mismo: hace falta `now()` y hace falta un
  // instante absoluto según el caso.
  instante: string,
): Promise<void> {
  await c.query("set local role postgres");
  await c.query(
    `insert into public.visita
       (id, tenant_id, rutero_parada_id, mercaderista_id, tienda_id, check_in_at)
     values ($1, $2, $3, $4, $5, ${instante})`,
    [
      `e3000003-0000-0000-0000-0000000000${sufijo}`,
      TENANTS.maracumango,
      parada,
      MERCADERISTA,
      TIENDA,
    ],
  );
  await c.query("set local role authenticated");
}

/** Cambia de usuario DENTRO de la misma transacción. Dos bloques `comoUsuario`
 *  son dos transacciones, y la primera hace rollback antes de que la segunda
 *  mire: lo sembrado en una no existe en la otra. */
async function comoOtro(c: Client, userId: string): Promise<void> {
  await c.query(
    `set local request.jwt.claims = '${JSON.stringify({
      sub: userId,
      role: "authenticated",
      aal: "aal2",
    })}'`,
  );
}

async function puntualidad(c: Client, parada: string): Promise<Fila> {
  const r = await c.query<Fila>(
    `select parada_id, fecha, minutos_desvio, dentro_tolerancia, asistencia
     from public.puntualidad_paradas($1, '2020-01-01'::date, '2035-01-01'::date)
     where parada_id = $2`,
    [MERCADERISTA, parada],
  );
  return r.rows[0]!;
}

describe("asistencia: tres estados, porque un booleano miente a media mañana", () => {
  it("una parada de HOY sin visitar está PENDIENTE, no faltada", async () => {
    // Con un booleano, el rutero de hoy marcaría inasistencia en todas las
    // paradas que aún no tocan y el puntaje se hundiría en vivo hasta la tarde.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "01", "app.hoy_lima()", null);
      expect((await puntualidad(c, p)).asistencia).toBe("pendiente");
    });
  });

  it("una parada de AYER sin visitar es una FALTA", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "02", "app.hoy_lima() - 1", null);
      expect((await puntualidad(c, p)).asistencia).toBe("falto");
    });
  });

  it("con check-in, asistió — aunque el día siga abierto", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "03", "app.hoy_lima()", null);
      await llegaA(c, p, "03", "now()");
      expect((await puntualidad(c, p)).asistencia).toBe("asistio");
    });
  });

  it("una falta NO es un retraso de cero: el desvío va nulo", async () => {
    // El criterio que separa "llegó a la hora" de "no llegó". Un cero los
    // confundiría y el promedio de puntualidad premiaría no aparecer.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "04", "app.hoy_lima() - 1", "09:00");
      const f = await puntualidad(c, p);
      expect(f.asistencia).toBe("falto");
      expect(f.minutos_desvio).toBeNull();
    });
  });
});

describe("desvío en minutos contra la hora esperada", () => {
  it("llegar tarde da un desvío POSITIVO", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "05", "'2026-07-20'", "09:00");
      // 09:25 de Lima = 14:25 UTC.
      await llegaA(c, p, "05", "'2026-07-20T14:25:00Z'");
      expect((await puntualidad(c, p)).minutos_desvio).toBe(25);
    });
  });

  it("llegar antes da un desvío NEGATIVO", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "06", "'2026-07-20'", "09:00");
      // 08:50 de Lima = 13:50 UTC.
      await llegaA(c, p, "06", "'2026-07-20T13:50:00Z'");
      expect((await puntualidad(c, p)).minutos_desvio).toBe(-10);
    });
  });

  it("sin hora esperada no hay desvío ni veredicto: no se dijo nada de esa parada", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "07", "'2026-07-20'", null);
      await llegaA(c, p, "07", "'2026-07-20T14:25:00Z'");
      const f = await puntualidad(c, p);
      expect(f.minutos_desvio).toBeNull();
      expect(f.dentro_tolerancia).toBeNull();
      expect(f.asistencia).toBe("asistio");
    });
  });

  it("la hora esperada es de LIMA, no de UTC", async () => {
    // Con la hora interpretada en UTC, un check-in a las 09:00 de Lima saldría
    // con cinco horas de adelanto y toda la puntualidad quedaría desplazada.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "08", "'2026-07-20'", "09:00");
      await llegaA(c, p, "08", "'2026-07-20T14:00:00Z'");
      expect((await puntualidad(c, p)).minutos_desvio).toBe(0);
    });
  });

  it("una parada de la tarde no rueda al día siguiente", async () => {
    // 20:00 de Lima es la 01:00 UTC del día siguiente: la hora esperada tiene que
    // anclarse a la fecha del rutero en Lima, no a la fecha UTC del check-in.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "09", "'2026-07-20'", "20:00");
      await llegaA(c, p, "09", "'2026-07-21T01:10:00Z'");
      expect((await puntualidad(c, p)).minutos_desvio).toBe(10);
    });
  });
});

describe("una parada no se cuenta dos veces", () => {
  it("dos visitas sobre la misma parada devuelven UNA fila, no dos", async () => {
    // Nada en el esquema lo impide: `visita.rutero_parada_id` no es único y una
    // reintentada desde el móvil crea la segunda. Con un `left join` a secas, la
    // parada saldría duplicada y contaría dos veces en el puntaje.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "40", "'2026-07-20'", "09:00");
      await llegaA(c, p, "40", "'2026-07-20T14:25:00Z'");
      await llegaA(c, p, "41", "'2026-07-20T15:00:00Z'");

      const r = await c.query(
        `select parada_id from public.puntualidad_paradas(
           $1, '2026-07-20'::date, '2026-07-20'::date)
         where parada_id = $2`,
        [MERCADERISTA, p],
      );
      expect(r.rows).toHaveLength(1);
    });
  });

  it("gana la PRIMERA llegada: se mide cuándo apareció, no el último intento", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "42", "'2026-07-20'", "09:00");
      // A propósito en orden inverso: la más tardía se inserta primero.
      await llegaA(c, p, "43", "'2026-07-20T15:00:00Z'");
      await llegaA(c, p, "44", "'2026-07-20T14:25:00Z'");

      expect((await puntualidad(c, p)).minutos_desvio).toBe(25);
    });
  });
});

describe("qué ruteros cuentan", () => {
  it("uno en curso y uno completado SÍ cuentan", async () => {
    // El filtro excluye solo el borrador. Un `= 'publicado'` dejaría fuera los
    // días que ya arrancaron, que son justo los que tienen datos.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const enCurso = await conParada(
        c,
        "45",
        "'2026-07-20'",
        "09:00",
        "en_curso",
      );
      const hecho = await conParada(
        c,
        "46",
        "'2026-07-21'",
        "09:00",
        "completado",
      );

      const r = await c.query<{ parada_id: string }>(
        `select parada_id from public.puntualidad_paradas(
           $1, '2026-07-20'::date, '2026-07-21'::date)`,
        [MERCADERISTA],
      );
      const ids = r.rows.map((f) => f.parada_id);
      expect(ids).toContain(enCurso);
      expect(ids).toContain(hecho);
    });
  });

  it("uno en BORRADOR no cuenta: nunca se le pidió al mercaderista", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "47", "'2026-07-20'", "09:00", "borrador");

      const r = await c.query(
        `select parada_id from public.puntualidad_paradas(
           $1, '2026-07-20'::date, '2026-07-20'::date)
         where parada_id = $2`,
        [MERCADERISTA, p],
      );
      expect(r.rows).toHaveLength(0);
    });
  });
});

describe("la tolerancia es del cliente y es política, no hecho", () => {
  it("llegar EN el minuto exacto del límite todavía es puntual", async () => {
    // El límite es inclusivo (`<=`). Sin fijarlo, cambiarlo a `<` no rompería
    // ningún test y un mercaderista pasaría a impuntual sin que nadie lo tocara.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "48", "'2026-07-20'", "09:00");
      await llegaA(c, p, "48", "'2026-07-20T14:15:00Z'"); // exactamente 15 min
      const f = await puntualidad(c, p);
      expect(f.minutos_desvio).toBe(15);
      expect(f.dentro_tolerancia).toBe(true);
    });
  });

  it("dentro de la tolerancia por defecto no cuenta como tarde, y el desvío se ve igual", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "10", "'2026-07-20'", "09:00");
      await llegaA(c, p, "10", "'2026-07-20T14:10:00Z'"); // 10 min, tope 15
      const f = await puntualidad(c, p);
      expect(f.dentro_tolerancia).toBe(true);
      // El hecho sigue expuesto: quien puntúe decide qué hacer con él.
      expect(f.minutos_desvio).toBe(10);
    });
  });

  it("pasada la tolerancia, es tarde", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "11", "'2026-07-20'", "09:00");
      await llegaA(c, p, "11", "'2026-07-20T14:16:00Z'");
      expect((await puntualidad(c, p)).dentro_tolerancia).toBe(false);
    });
  });

  it("bajar la tolerancia del cliente convierte en tarde lo que antes no lo era", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "12", "'2026-07-20'", "09:00");
      await llegaA(c, p, "12", "'2026-07-20T14:10:00Z'");
      expect((await puntualidad(c, p)).dentro_tolerancia).toBe(true);

      await c.query("set local role postgres");
      await c.query(
        `update public.tenant set tolerancia_puntualidad_min = 5 where id = $1`,
        [TENANTS.maracumango],
      );
      await c.query("set local role authenticated");

      expect((await puntualidad(c, p)).dentro_tolerancia).toBe(false);
    });
  });

  it("una tolerancia negativa no se puede guardar", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query("set local role postgres");
      await expect(
        c.query(
          `update public.tenant set tolerancia_puntualidad_min = -1 where id = $1`,
          [TENANTS.maracumango],
        ),
      ).rejects.toThrow();
    });
  });
});

describe("quién puede leer y escribir", () => {
  it("el mercaderista ve SUS paradas", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "13", "'2026-07-20'", "09:00");

      await comoOtro(c, MERCADERISTA);
      const r = await c.query<{ parada_id: string }>(
        `select parada_id from public.puntualidad_paradas(
           $1, '2026-07-20'::date, '2026-07-20'::date)`,
        [MERCADERISTA],
      );
      expect(r.rows.map((f) => f.parada_id)).toContain(p);
    });
  });

  it("el mercaderista del cliente rival no ve las de este", async () => {
    // Con la fila sembrada en ESTA misma transacción: si el rival consultara una
    // base vacía, el test pasaría sin probar el aislamiento.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await conParada(c, "17", "'2026-07-20'", "09:00");

      await comoOtro(c, USUARIOS.mercaderistaRival);
      const r = await c.query(
        `select parada_id from public.puntualidad_paradas(
           $1, '2026-07-20'::date, '2026-07-20'::date)`,
        [MERCADERISTA],
      );
      expect(r.rows).toHaveLength(0);
    });
  });

  it("anon no puede ejecutar ninguna de las funciones nuevas", async () => {
    const r = await db.query<{ proname: string; anon: boolean; pub: boolean }>(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('public', p.oid, 'execute') as pub
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('puntualidad_paradas', 'fijar_hora_parada',
                          'planeacion_ruteros')
    `);
    expect(r.rows).toHaveLength(3);
    expect(r.rows.filter((f) => f.anon || f.pub).map((f) => f.proname)).toEqual(
      [],
    );
  });

  it("el mercaderista NO puede fijar la hora de una parada", async () => {
    // Es diseño de ruteros: si pudiera moverla, la puntualidad la fijaría el
    // evaluado.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "14", "'2026-07-20'", "09:00");

      await comoOtro(c, MERCADERISTA);
      await expect(
        c.query(`select public.fijar_hora_parada($1, '10:00')`, [p]),
      ).rejects.toThrow(/staff/);
    });
  });

  it("la hora NO se cambia una vez publicado el rutero", async () => {
    // El trigger que protege la planeación exime todo UPDATE que no toque
    // rutero_id, tienda_id ni orden, así que esta columna se le escapa. Sin este
    // guard, un supervisor podría fijar la hora DESPUÉS de ver a qué hora fichó
    // el mercaderista y fabricar el resultado del bono.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "49", "'2026-07-20'", "09:00", "publicado");

      await expect(
        c.query(`select public.fijar_hora_parada($1, '07:00')`, [p]),
      ).rejects.toThrow(/ya salió del borrador/);
    });
  });

  it("el staff la fija y la puede quitar", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "15", "'2026-07-20'", null, "borrador");

      await c.query(`select public.fijar_hora_parada($1, '08:30')`, [p]);
      const puesta = await c.query<{ hora_planificada: string }>(
        `select hora_planificada from public.rutero_parada where id = $1`,
        [p],
      );
      expect(puesta.rows[0]?.hora_planificada).toBe("08:30:00");

      await c.query(`select public.fijar_hora_parada($1, null)`, [p]);
      const quitada = await c.query<{ hora_planificada: string | null }>(
        `select hora_planificada from public.rutero_parada where id = $1`,
        [p],
      );
      expect(quitada.rows[0]?.hora_planificada).toBeNull();
    });
  });

  it("fijar la hora de una parada que no existe falla, no pasa de largo", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await expect(
        c.query(
          `select public.fijar_hora_parada(
             'e3000099-0000-0000-0000-000000000099', '08:30')`,
        ),
      ).rejects.toThrow(/no existe/);
    });
  });
});

describe("la planeación lleva la hora", () => {
  it("la devuelve junto a la parada", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await conParada(c, "16", "'2026-07-20'", "07:45");

      const r = await c.query<{ hora_planificada: string | null }>(
        `select hora_planificada from public.planeacion_ruteros(
           $1, '2026-07-20'::date, '2026-07-20'::date)`,
        [MERCADERISTA],
      );
      expect(r.rows.map((f) => f.hora_planificada)).toContain("07:45:00");
    });
  });
});
