import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// El motor del plan de lealtad del mercaderista. Puntúa SOLO lo que él controla:
// puntualidad, asistencia, calidad de su registro y las herramientas que lleva.
//
// Los dos criterios que de verdad importan y que aquí se fijan:
//   · un periodo CERRADO no se mueve, ni cambiando los pesos (de ahí sale un bono);
//   · una variable no evaluada renormaliza su peso, nunca puntúa cero.

const MERCADERISTA = USUARIOS.mercaderistaMaracumango;
const TIENDA = "a0000002-0000-0000-0000-000000000001";
const MARCA = "cccccccc-0000-0000-0000-000000000001";
const CONFIG_SEED = "a0000021-0000-0000-0000-000000000001";

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

type Puntaje = {
  puntualidad_pct: string | null;
  asistencia_pct: string | null;
  tiempo_efectivo_pct: string | null;
  calidad_pct: string | null;
  herramientas_pct: string | null;
  total_pct: string | null;
  paradas_evaluables: number;
  paradas_asistidas: number;
  paradas_con_hora: number;
  paradas_puntuales: number;
  campos_obligatorios: number;
  campos_respondidos: number;
  fotos_esperadas: number;
  fotos_presentes: number;
  items_checklist: number;
  items_cumplidos: number;
  config_id: string;
  nivel_bono_id: string | null;
  cerrado_at: string | null;
  calculado_at: string;
};

/** Un id irrepetible por caso: cada test siembra el suyo y hace rollback. */
function id(prefijo: string, sufijo: string): string {
  return `e400000${prefijo}-0000-0000-0000-0000000000${sufijo}`;
}

/**
 * Un rutero PUBLICADO con una parada, en la fecha y hora dadas.
 *
 * `fecha` es una EXPRESIÓN SQL, no un valor: los casos interesantes son
 * relativos al día de Lima y como parámetro no se evaluarían. Son literales del
 * propio test, no entrada de nadie.
 */
async function conParada(
  c: Client,
  sufijo: string,
  fecha: string,
  hora: string | null,
  estado: "borrador" | "publicado" = "publicado",
): Promise<string> {
  const rutero = id("1", sufijo);
  const parada = id("2", sufijo);

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

/** Un check-in sobre esa parada. `instante` también es una expresión SQL. */
async function llegaA(
  c: Client,
  parada: string,
  sufijo: string,
  instante: string,
  versionCheckIn: string | null = null,
): Promise<string> {
  const visita = id("3", sufijo);
  await c.query("set local role postgres");
  await c.query(
    `insert into public.visita
       (id, tenant_id, rutero_parada_id, mercaderista_id, tienda_id,
        check_in_at, formulario_version_id)
     values ($1, $2, $3, $4, $5, ${instante}, $6)`,
    [visita, TENANTS.maracumango, parada, MERCADERISTA, TIENDA, versionCheckIn],
  );
  await c.query("set local role authenticated");
  return visita;
}

/** Un formulario con una versión publicada, del ámbito dado. Devuelve la versión. */
async function conFormulario(
  c: Client,
  sufijo: string,
  ambito: "levantamiento" | "check_in",
  campos: { id: string; tipo: string; obligatorio?: boolean }[],
): Promise<string> {
  const formulario = id("4", sufijo);
  const version = id("5", sufijo);
  const definicion = {
    pasos: [
      {
        id: "p1",
        titulo: "Paso",
        orden: 0,
        campos: campos.map((x) => ({
          id: x.id,
          tipo: x.tipo,
          etiqueta: x.id,
          obligatorio: x.obligatorio ?? true,
        })),
      },
    ],
  };

  await c.query("set local role postgres");
  await c.query(
    `insert into public.formulario_levantamiento (id, tenant_id, nombre, ambito)
     values ($1, $2, $3, $4)`,
    [formulario, TENANTS.maracumango, `F-${sufijo}`, ambito],
  );
  await c.query(
    `insert into public.formulario_version
       (id, tenant_id, formulario_id, version, definicion, publicada)
     values ($1, $2, $3, 1, $4::jsonb, true)`,
    [version, TENANTS.maracumango, formulario, JSON.stringify(definicion)],
  );
  await c.query("set local role authenticated");
  return version;
}

async function conLevantamiento(
  c: Client,
  sufijo: string,
  visita: string,
  version: string | null,
  estado: "completado" | "omitido" = "completado",
): Promise<string> {
  const lev = id("6", sufijo);
  await c.query("set local role postgres");
  await c.query(
    `insert into public.levantamiento
       (id, tenant_id, visita_id, marca_id, estado, formulario_version_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [lev, TENANTS.maracumango, visita, MARCA, estado, version],
  );
  await c.query("set local role authenticated");
  return lev;
}

async function conFoto(
  c: Client,
  sufijo: string,
  visita: string,
  levantamiento: string | null,
  tipo: string,
  hash: string | null = "sha256",
): Promise<void> {
  await c.query("set local role postgres");
  await c.query(
    `insert into public.foto
       (id, tenant_id, visita_id, levantamiento_id, tipo, hash, capturada_at)
     values ($1, $2, $3, $4, $5, $6, now())`,
    [id("7", sufijo), TENANTS.maracumango, visita, levantamiento, tipo, hash],
  );
  await c.query("set local role authenticated");
}

async function conRespuestaLev(
  c: Client,
  sufijo: string,
  levantamiento: string,
  campo: string,
  valor: string,
): Promise<void> {
  await c.query("set local role postgres");
  await c.query(
    `insert into public.levantamiento_respuesta
       (id, tenant_id, levantamiento_id, campo_id, valor)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [id("8", sufijo), TENANTS.maracumango, levantamiento, campo, valor],
  );
  await c.query("set local role authenticated");
}

async function conRespuestaVisita(
  c: Client,
  sufijo: string,
  visita: string,
  campo: string,
  valor: string,
): Promise<void> {
  await c.query("set local role postgres");
  await c.query(
    `insert into public.visita_respuesta
       (id, tenant_id, visita_id, campo_id, valor)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [id("9", sufijo), TENANTS.maracumango, visita, campo, valor],
  );
  await c.query("set local role authenticated");
}

async function conContingencia(
  c: Client,
  sufijo: string,
  visita: string,
  levantamiento: string,
  paso: string,
): Promise<void> {
  await c.query("set local role postgres");
  await c.query(
    `insert into public.contingencia
       (id, tenant_id, visita_id, levantamiento_id, paso, motivo, registrada_at)
     values ($1, $2, $3, $4, $5, 'sin señal', now())`,
    [id("a", sufijo), TENANTS.maracumango, visita, levantamiento, paso],
  );
  await c.query("set local role authenticated");
}

/** Calcula y devuelve la fila. `inicio` es una expresión SQL. */
async function calcular(
  c: Client,
  inicio: string,
  tipo = "mensual",
): Promise<Puntaje | undefined> {
  await c.query("set local role postgres");
  await c.query(`select app.calcular_puntaje_merchandiser($1, $2, ${inicio})`, [
    MERCADERISTA,
    tipo,
  ]);
  const r = await c.query<Puntaje>(
    `select * from public.puntaje_merchandiser
     where mercaderista_id = $1 and tipo = $2 and periodo_inicio = ${inicio}`,
    [MERCADERISTA, tipo],
  );
  await c.query("set local role authenticated");
  return r.rows[0];
}

// El mes en curso: su periodo sigue ABIERTO (no ha pasado ni el fin ni la
// gracia), que es lo que hace falta para probar el recálculo.
const MES_ACTUAL = `date_trunc('month', app.hoy_lima()::timestamp)::date`;
// Un mes bien pasado: su periodo ya está CERRADO. La config del seed rige desde
// 2026-01-01, así que cualquier mes desde entonces la encuentra.
const MES_CERRADO = `'2026-02-01'::date`;
/** Un instante de ese día, en Lima. El `::timestamp` es obligatorio: sin él el
 *  literal se infiere como timestamptz y `at time zone` lo convierte al revés. */
const enLima = (fecha: string, hora: string) =>
  `('${fecha} ${hora}'::timestamp at time zone 'America/Lima')`;
/** La misma hora, pero sobre un día relativo al de Lima. */
const horasEnElDia = (dias: string, hora: string) =>
  `(((app.hoy_lima() + ${dias})::text || ' ${hora}')::timestamp at time zone 'America/Lima')`;

describe("puntualidad: llegar tarde resta, no llegar resta más", () => {
  it("llegar en punto puntúa 100", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "01", MES_ACTUAL, "09:00");
      await llegaA(c, p, "01", horasEnElDia("- 0", "09:00"));
      // La parada es del primer día del mes; el check-in, del día de hoy. Se
      // fija la fecha del rutero al día de hoy para que coincidan.
      await c.query("set local role postgres");
      await c.query(
        `update public.rutero set fecha = app.hoy_lima() where id = $1`,
        [id("1", "01")],
      );
      await c.query("set local role authenticated");

      const r = await calcular(c, MES_ACTUAL);
      expect(r?.puntualidad_pct).toBe("100.00");
      expect(r?.paradas_puntuales).toBe(1);
    });
  });

  it("dentro de la tolerancia sigue siendo 100", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "02", "'2026-02-10'::date", "09:00");
      // Tolerancia del seed: 15 minutos.
      await llegaA(c, p, "02", enLima("2026-02-10", "09:14"));
      expect((await calcular(c, MES_CERRADO))?.puntualidad_pct).toBe("100.00");
    });
  });

  it("llegar ANTES no sube de 100: la velocidad por sí sola nunca premia", async () => {
    // El incentivo perverso que el cliente quiso evitar. Un adelanto enorme
    // tiene que dar exactamente lo mismo que llegar en punto.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "03", "'2026-02-10'::date", "09:00");
      await llegaA(c, p, "03", enLima("2026-02-10", "06:00"));
      expect((await calcular(c, MES_CERRADO))?.puntualidad_pct).toBe("100.00");
    });
  });

  it("a mitad de la rampa puntúa la mitad", async () => {
    // Tolerancia 15, cero a los 60: el punto medio son 37,5 min de desvío.
    // Con 37 min: 100 * (1 - (37-15)/45) = 51.11
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "04", "'2026-02-10'::date", "09:00");
      await llegaA(c, p, "04", enLima("2026-02-10", "09:37"));
      expect((await calcular(c, MES_CERRADO))?.puntualidad_pct).toBe("51.11");
    });
  });

  it("pasado el tope de tardanza puntúa 0, nunca negativo", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "05", "'2026-02-10'::date", "09:00");
      await llegaA(c, p, "05", enLima("2026-02-10", "18:00"));
      expect((await calcular(c, MES_CERRADO))?.puntualidad_pct).toBe("0.00");
    });
  });

  it("no llegar puntúa 0 en puntualidad Y 0 en asistencia: el doble golpe", async () => {
    // "Una cosa es que llegues tarde, pero otra cosa es que ni siquiera
    // llegues": el ausente pierde en dos variables, el tardío solo en una.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await conParada(c, "06", "'2026-02-10'::date", "09:00");
      const r = await calcular(c, MES_CERRADO);
      expect(r?.puntualidad_pct).toBe("0.00");
      expect(r?.asistencia_pct).toBe("0.00");
      expect(r?.paradas_evaluables).toBe(1);
      expect(r?.paradas_con_hora).toBe(1);
    });
  });

  it("una parada SIN hora planificada no puntúa ni penaliza puntualidad", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "07", "'2026-02-10'::date", null);
      await llegaA(c, p, "07", enLima("2026-02-10", "23:00"));
      const r = await calcular(c, MES_CERRADO);
      // Sin ninguna parada con hora, la variable entera queda sin evaluar.
      expect(r?.puntualidad_pct).toBeNull();
      expect(r?.paradas_con_hora).toBe(0);
      // Pero sí cuenta para asistencia: apareció.
      expect(r?.asistencia_pct).toBe("100.00");
    });
  });

  it("una parada de un rutero en BORRADOR no cuenta: nadie se la pidió", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await conParada(c, "08", "'2026-02-10'::date", "09:00", "borrador");
      const r = await calcular(c, MES_CERRADO);
      expect(r?.paradas_evaluables).toBe(0);
      expect(r?.asistencia_pct).toBeNull();
    });
  });

  it("usa la tolerancia de la CONFIG, no la editable del tenant", async () => {
    // El reparto que MAR-89 dejó anunciado: el hecho (minutos de desvío) es de
    // `puntualidad_paradas`; la política (cuántos minutos son tarde) es del
    // motor y está congelada. Subir la del tenant no puede mover el puntaje.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "09", "'2026-02-10'::date", "09:00");
      await llegaA(c, p, "09", enLima("2026-02-10", "09:37"));

      await c.query("set local role postgres");
      await c.query(
        `update public.tenant set tolerancia_puntualidad_min = 120 where id = $1`,
        [TENANTS.maracumango],
      );
      await c.query("set local role authenticated");

      // Con la tolerancia del tenant (120) sería 100; con la de la config (15),
      // 51.11. Manda la de la config.
      expect((await calcular(c, MES_CERRADO))?.puntualidad_pct).toBe("51.11");
    });
  });
});

describe("asistencia", () => {
  it("es la proporción de paradas visitadas sobre las evaluables", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p1 = await conParada(c, "10", "'2026-02-10'::date", null);
      await llegaA(c, p1, "10", enLima("2026-02-10", "09:00"));
      await conParada(c, "11", "'2026-02-11'::date", null);

      const r = await calcular(c, MES_CERRADO);
      expect(r?.asistencia_pct).toBe("50.00");
      expect(r?.paradas_evaluables).toBe(2);
      expect(r?.paradas_asistidas).toBe(1);
    });
  });

  it("una parada PENDIENTE (el día aún no cerró en Lima) queda fuera", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await conParada(c, "12", "app.hoy_lima()", "09:00");
      const r = await calcular(c, MES_ACTUAL);
      expect(r?.paradas_evaluables).toBe(0);
      expect(r?.asistencia_pct).toBeNull();
    });
  });

  it("sin paradas en el periodo la variable es NULL, no 0", async () => {
    // A quien entró a mitad de periodo no se le castiga por los días en que no
    // trabajaba aquí.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await calcular(c, MES_CERRADO);
      expect(r?.asistencia_pct).toBeNull();
      expect(r?.paradas_evaluables).toBe(0);
    });
  });
});

describe("calidad de registro", () => {
  it("cuenta los campos obligatorios de la definición ANCLADA", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const v = await conFormulario(c, "20", "levantamiento", [
        { id: "temp", tipo: "decimal" },
        { id: "nota", tipo: "texto" },
        { id: "opcional", tipo: "texto", obligatorio: false },
      ]);
      const p = await conParada(c, "20", "'2026-02-10'::date", null);
      const visita = await llegaA(c, p, "20", enLima("2026-02-10", "09:00"));
      const lev = await conLevantamiento(c, "20", visita, v);
      await conRespuestaLev(c, "20", lev, "temp", "4.5");
      await conFoto(c, "20", visita, lev, "antes");
      await conFoto(c, "21", visita, lev, "despues");

      const r = await calcular(c, MES_CERRADO);
      // 2 obligatorios (el opcional no cuenta), 1 respondido; 2 fotos de 2.
      expect(r?.campos_obligatorios).toBe(2);
      expect(r?.campos_respondidos).toBe(1);
      expect(r?.fotos_esperadas).toBe(2);
      expect(r?.fotos_presentes).toBe(2);
      expect(r?.calidad_pct).toBe("75.00");
    });
  });

  it("un booleano `false` SÍ cuenta como respondido: es una respuesta", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const v = await conFormulario(c, "21", "levantamiento", [
        { id: "hay_pop", tipo: "booleano" },
      ]);
      const p = await conParada(c, "22", "'2026-02-10'::date", null);
      const visita = await llegaA(c, p, "22", enLima("2026-02-10", "09:00"));
      const lev = await conLevantamiento(c, "22", visita, v);
      await conRespuestaLev(c, "22", lev, "hay_pop", "false");
      await conFoto(c, "22", visita, lev, "antes");
      await conFoto(c, "23", visita, lev, "despues");

      const r = await calcular(c, MES_CERRADO);
      expect(r?.campos_respondidos).toBe(1);
      expect(r?.calidad_pct).toBe("100.00");
    });
  });

  it("un levantamiento OMITIDO por contingencia queda fuera entero", async () => {
    // Penalizarlo sería castigar dos veces el bypass que el propio producto
    // ofrece para no bloquear al mercaderista en tienda.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const v = await conFormulario(c, "22", "levantamiento", [
        { id: "temp", tipo: "decimal" },
      ]);
      const p = await conParada(c, "23", "'2026-02-10'::date", null);
      const visita = await llegaA(c, p, "23", enLima("2026-02-10", "09:00"));
      await conLevantamiento(c, "23", visita, v, "omitido");

      const r = await calcular(c, MES_CERRADO);
      expect(r?.campos_obligatorios).toBe(0);
      expect(r?.calidad_pct).toBeNull();
    });
  });

  it("una contingencia en la foto BAJA la expectativa, no penaliza", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "24", "'2026-02-10'::date", null);
      const visita = await llegaA(c, p, "24", enLima("2026-02-10", "09:00"));
      const lev = await conLevantamiento(c, "24", visita, null);
      await conContingencia(c, "24", visita, lev, "foto_antes");
      await conFoto(c, "24", visita, lev, "despues");

      const r = await calcular(c, MES_CERRADO);
      // Se esperaba 1 foto (la de después), y está.
      expect(r?.fotos_esperadas).toBe(1);
      expect(r?.fotos_presentes).toBe(1);
      expect(r?.calidad_pct).toBe("100.00");
    });
  });

  it("una foto sin hash no cuenta: el pipeline de captura falló", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "25", "'2026-02-10'::date", null);
      const visita = await llegaA(c, p, "25", enLima("2026-02-10", "09:00"));
      const lev = await conLevantamiento(c, "25", visita, null);
      await conFoto(c, "25", visita, lev, "antes", null);
      await conFoto(c, "26", visita, lev, "despues");

      const r = await calcular(c, MES_CERRADO);
      expect(r?.fotos_presentes).toBe(1);
      expect(r?.calidad_pct).toBe("50.00");
    });
  });

  it("fotos de MÁS no inflan el puntaje por encima de lo esperado", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "26", "'2026-02-10'::date", null);
      const visita = await llegaA(c, p, "26", enLima("2026-02-10", "09:00"));
      const lev = await conLevantamiento(c, "26", visita, null);
      await conFoto(c, "27", visita, lev, "antes");
      await conFoto(c, "28", visita, lev, "antes");
      await conFoto(c, "29", visita, lev, "antes");

      const r = await calcular(c, MES_CERRADO);
      // Tres "antes" siguen valiendo una: el tope es lo esperado.
      expect(r?.fotos_presentes).toBe(1);
      expect(r?.calidad_pct).toBe("50.00");
    });
  });

  it("cuenta FILAS foto, no el uuid guardado en el valor de la respuesta", async () => {
    // La regla heredada de MAR-117: la referencia dentro de `valor` no tiene
    // verja de autenticidad y apuntarla a cualquier foto legible es trivial.
    // Aquí la respuesta apunta a una foto REAL de otra visita: no debe sumar.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const v = await conFormulario(c, "27", "levantamiento", [
        { id: "foto_extra", tipo: "foto" },
      ]);
      const otra = await conParada(c, "27", "'2026-02-09'::date", null);
      const visitaOtra = await llegaA(
        c,
        otra,
        "27",
        enLima("2026-02-09", "09:00"),
      );
      await conFoto(c, "30", visitaOtra, null, "campo_extra");

      const p = await conParada(c, "28", "'2026-02-10'::date", null);
      const visita = await llegaA(c, p, "28", enLima("2026-02-10", "09:00"));
      const lev = await conLevantamiento(c, "28", visita, v);
      await conRespuestaLev(
        c,
        "28",
        lev,
        "foto_extra",
        JSON.stringify(id("7", "30")),
      );
      await conFoto(c, "31", visita, lev, "antes");
      await conFoto(c, "32", visita, lev, "despues");

      const r = await calcular(c, MES_CERRADO);
      // Se esperaban 3 fotos (antes, después y la del campo) y solo hay 2: la
      // referencia prestada no cuenta.
      expect(r?.fotos_esperadas).toBe(3);
      expect(r?.fotos_presentes).toBe(2);
    });
  });
});

describe("herramientas de trabajo", () => {
  it("un booleano `false` NO cuenta como cumplido: declaró no llevarla", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const v = await conFormulario(c, "30", "check_in", [
        { id: "botas", tipo: "booleano" },
        { id: "casco", tipo: "booleano" },
      ]);
      const p = await conParada(c, "30", "'2026-02-10'::date", null);
      const visita = await llegaA(c, p, "30", enLima("2026-02-10", "09:00"), v);
      await conRespuestaVisita(c, "30", visita, "botas", "true");
      await conRespuestaVisita(c, "31", visita, "casco", "false");

      const r = await calcular(c, MES_CERRADO);
      expect(r?.items_checklist).toBe(2);
      expect(r?.items_cumplidos).toBe(1);
      expect(r?.herramientas_pct).toBe("50.00");
    });
  });

  it("no tomar la foto pesa IGUAL que declarar que no la lleva", async () => {
    // La decisión de diseño acordada con el cliente: "si no tienen las
    // herramientas es igual a que no tomaran la foto". Los dos casos tienen que
    // dar exactamente el mismo porcentaje.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const v = await conFormulario(c, "31", "check_in", [
        { id: "botas", tipo: "booleano" },
        { id: "prueba", tipo: "foto" },
      ]);

      // Caso A: contesta el booleano, no toma la foto.
      const pA = await conParada(c, "31", "'2026-02-10'::date", null);
      const vA = await llegaA(c, pA, "31", enLima("2026-02-10", "09:00"), v);
      await conRespuestaVisita(c, "32", vA, "botas", "true");
      const rA = await calcular(c, MES_CERRADO);

      // Caso B: toma la foto, declara que no lleva las botas.
      await c.query("set local role postgres");
      await c.query(`delete from public.puntaje_merchandiser`);
      await c.query(
        `delete from public.visita_respuesta where visita_id = $1`,
        [vA],
      );
      await c.query("set local role authenticated");
      await conRespuestaVisita(c, "33", vA, "botas", "false");
      await conFoto(c, "33", vA, null, "campo_extra");
      const rB = await calcular(c, MES_CERRADO);

      expect(rA?.herramientas_pct).toBe("50.00");
      expect(rB?.herramientas_pct).toBe(rA?.herramientas_pct);
    });
  });

  it("una visita SIN checklist configurado queda fuera del denominador", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const v = await conFormulario(c, "32", "check_in", [
        { id: "botas", tipo: "booleano" },
      ]);
      const p1 = await conParada(c, "32", "'2026-02-10'::date", null);
      const v1 = await llegaA(c, p1, "32", enLima("2026-02-10", "09:00"), v);
      await conRespuestaVisita(c, "34", v1, "botas", "true");
      // Esta visita no tiene formulario anclado: no se le pidió checklist.
      const p2 = await conParada(c, "33", "'2026-02-11'::date", null);
      await llegaA(c, p2, "33", enLima("2026-02-11", "09:00"));

      const r = await calcular(c, MES_CERRADO);
      expect(r?.items_checklist).toBe(1);
      expect(r?.herramientas_pct).toBe("100.00");
    });
  });

  it("ninguna visita con checklist deja la variable en NULL y renormaliza", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "34", "'2026-02-10'::date", "09:00");
      await llegaA(c, p, "34", enLima("2026-02-10", "09:00"));

      const r = await calcular(c, MES_CERRADO);
      expect(r?.herramientas_pct).toBeNull();
      // Puntualidad y asistencia al 100 y las otras sin evaluar: el total es 100.
      expect(r?.total_pct).toBe("100.00");
    });
  });

  it("cuenta la foto del CHECK-IN, no la de un campo del levantamiento", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const v = await conFormulario(c, "33", "check_in", [
        { id: "prueba", tipo: "foto" },
      ]);
      const p = await conParada(c, "35", "'2026-02-10'::date", null);
      const visita = await llegaA(c, p, "35", enLima("2026-02-10", "09:00"), v);
      const lev = await conLevantamiento(c, "35", visita, null);
      // Una foto de campo del LEVANTAMIENTO: no es la del checklist.
      await conFoto(c, "34", visita, lev, "campo_extra");

      const r = await calcular(c, MES_CERRADO);
      expect(r?.items_cumplidos).toBe(0);
      expect(r?.herramientas_pct).toBe("0.00");
    });
  });
});

describe("el tiempo efectivo de atención llega DESACTIVADO", () => {
  it("su porcentaje es siempre NULL, aunque las otras se evalúen", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "40", "'2026-02-10'::date", "09:00");
      await llegaA(c, p, "40", enLima("2026-02-10", "09:00"));
      expect((await calcular(c, MES_CERRADO))?.tiempo_efectivo_pct).toBeNull();
    });
  });

  it("la base rechaza una configuración que le dé peso", async () => {
    // Con un peso libre, la renormalización lo repartiría entre las otras cuatro
    // EN SILENCIO y los pesos efectivos no serían los que el admin ve.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await expect(
        c.query(
          `insert into public.config_perfect_merchandiser
             (tenant_id, peso_puntualidad, peso_asistencia, peso_tiempo_efectivo,
              peso_calidad, peso_herramientas, tolerancia_puntualidad_min,
              vigente_desde)
           values ($1, 20, 20, 20, 20, 20, 15, '2026-03-01')`,
          [TENANTS.maracumango],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "config_pm_tiempo_efectivo_apagado",
      });
    });
  });
});

describe("ponderado: una variable no evaluada renormaliza, no puntúa cero", () => {
  it("reparte el peso de las variables sin datos entre las evaluadas", async () => {
    // Pesos del seed: puntualidad 25, asistencia 30, calidad 25, herramientas 20.
    // Con solo puntualidad (88.89) y asistencia (100) evaluadas:
    //   (25*88.89 + 30*100) / 55 = 94.95
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "41", "'2026-02-10'::date", "09:00");
      await llegaA(c, p, "41", enLima("2026-02-10", "09:20"));
      const r = await calcular(c, MES_CERRADO);
      expect(r?.puntualidad_pct).toBe("88.89");
      expect(r?.total_pct).toBe("94.95");
    });
  });

  it("sin ninguna variable evaluada el total es NULL y no hay bono", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await calcular(c, MES_CERRADO);
      expect(r?.total_pct).toBeNull();
      expect(r?.nivel_bono_id).toBeNull();
    });
  });
});

describe("niveles de bono: una escalera de umbrales", () => {
  async function conPuntaje(c: Client, sufijo: string, hora: string) {
    const p = await conParada(c, sufijo, "'2026-02-10'::date", "09:00");
    await llegaA(c, p, sufijo, enLima("2026-02-10", hora));
    return calcular(c, MES_CERRADO);
  }

  it("gana el umbral más alto que el puntaje supera", async () => {
    // Escalera del seed: Bronce 60, Plata 80, Oro 95. Llegar en punto da 100.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await conPuntaje(c, "50", "09:00");
      const nivel = await c.query<{ nombre: string }>(
        `select nombre from public.nivel_bono_merchandiser where id = $1`,
        [r?.nivel_bono_id],
      );
      expect(nivel.rows[0]?.nombre).toBe("Oro");
    });
  });

  it("por debajo del umbral más bajo no hay nivel", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // Llega catorce horas tarde: puntualidad 0, asistencia 100 (apareció).
      // Ponderado: (25*0 + 30*100) / 55 = 54.55, por debajo de Bronce (60).
      const r = await conPuntaje(c, "51", "23:00");
      expect(r?.total_pct).toBe("54.55");
      expect(r?.nivel_bono_id).toBeNull();
    });
  });

  it("una escalera nueva REEMPLAZA la anterior entera", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query(
        `insert into public.nivel_bono_merchandiser
           (tenant_id, vigente_desde, nombre, puntaje_min, monto)
         values ($1, '2026-02-01', 'Único nivel', 50, 999)`,
        [TENANTS.maracumango],
      );
      const r = await conPuntaje(c, "52", "09:00");
      const nivel = await c.query<{ nombre: string }>(
        `select nombre from public.nivel_bono_merchandiser where id = $1`,
        [r?.nivel_bono_id],
      );
      // La escalera de febrero es la vigente: la de enero entera desaparece.
      expect(nivel.rows[0]?.nombre).toBe("Único nivel");
    });
  });
});

describe("el periodo: alineado, en el día de Lima, y cerrado para siempre", () => {
  it("rechaza un periodo mensual que no empiece el día 1", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query("set local role postgres");
      await expect(
        c.query(
          `insert into public.puntaje_merchandiser
             (mercaderista_id, tipo, periodo_inicio, tenant_id, config_id)
           values ($1, 'mensual', '2026-02-07', $2, $3)`,
          [MERCADERISTA, TENANTS.maracumango, CONFIG_SEED],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "pm_periodo_alineado",
      });
    });
  });

  it("un trimestral solo empieza en enero, abril, julio u octubre", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query("set local role postgres");
      await expect(
        c.query(
          `insert into public.puntaje_merchandiser
             (mercaderista_id, tipo, periodo_inicio, tenant_id, config_id)
           values ($1, 'trimestral', '2026-02-01', $2, $3)`,
          [MERCADERISTA, TENANTS.maracumango, CONFIG_SEED],
        ),
      ).rejects.toMatchObject({ constraint: "pm_periodo_alineado" });
    });
  });

  it("la ventana es el día de LIMA: un check-in de las 20:00 del último día cuenta", async () => {
    // A las 20:05 de Lima ya es el día siguiente en UTC. Si la ventana se
    // resolviera en UTC, esta visita saldría del mes y el mercaderista perdería
    // un día de trabajo real.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "60", "'2026-02-28'::date", "09:00");
      await llegaA(c, p, "60", enLima("2026-02-28", "20:05"));
      const r = await calcular(c, MES_CERRADO);
      expect(r?.paradas_evaluables).toBe(1);
      expect(r?.paradas_asistidas).toBe(1);
    });
  });

  it("un periodo terminado pero DENTRO de la gracia sigue abierto", async () => {
    // El móvil es offline-first: cerrar antes de que sincronice le cobraría al
    // mercaderista la falta de cobertura de su zona.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // Un periodo mensual que acabó ayer: la gracia del seed son 7 días.
      const inicio = `date_trunc('month', (app.hoy_lima() - 1)::timestamp)::date`;
      await c.query("set local role postgres");
      await c.query(
        `select app.calcular_puntaje_merchandiser($1,'mensual',${inicio})`,
        [MERCADERISTA],
      );
      const r = await c.query<Puntaje>(
        `select cerrado_at from public.puntaje_merchandiser
         where mercaderista_id = $1 and periodo_inicio = ${inicio}`,
        [MERCADERISTA],
      );
      await c.query("set local role authenticated");
      expect(r.rows[0]?.cerrado_at).toBeNull();
    });
  });

  it("pasada la gracia, el propio cálculo lo sella", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await calcular(c, MES_CERRADO);
      expect(r?.cerrado_at).not.toBeNull();
    });
  });

  it("★ un periodo CERRADO no se mueve aunque cambien los pesos y la escalera", async () => {
    // El test que sostiene el criterio de aceptación: de esta fila salió un bono
    // que ya se pagó. Ni los pesos ni los niveles pueden reescribirla.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await conParada(c, "61", "'2026-02-10'::date", "09:00");
      await llegaA(c, p, "61", enLima("2026-02-10", "09:20"));
      const antes = await calcular(c, MES_CERRADO);
      expect(antes?.cerrado_at).not.toBeNull();
      expect(antes?.total_pct).toBe("94.95");

      // Una configuración radicalmente distinta, vigente desde antes del periodo.
      await c.query(
        `insert into public.config_perfect_merchandiser
           (tenant_id, peso_puntualidad, peso_asistencia, peso_tiempo_efectivo,
            peso_calidad, peso_herramientas, tolerancia_puntualidad_min,
            minutos_tardanza_cero, vigente_desde)
         values ($1, 90, 10, 0, 0, 0, 0, 5, '2026-01-15')`,
        [TENANTS.maracumango],
      );
      await c.query(
        `insert into public.nivel_bono_merchandiser
           (tenant_id, vigente_desde, nombre, puntaje_min, monto)
         values ($1, '2026-01-15', 'Nuevo', 0, 1)`,
        [TENANTS.maracumango],
      );

      const despues = await calcular(c, MES_CERRADO);
      expect(despues?.total_pct).toBe(antes?.total_pct);
      expect(despues?.config_id).toBe(antes?.config_id);
      expect(despues?.nivel_bono_id).toBe(antes?.nivel_bono_id);
      expect(despues?.calculado_at).toEqual(antes?.calculado_at);
    });
  });

  it("un periodo ABIERTO sí recalcula al cambiar los pesos", async () => {
    // La otra cara: mientras el periodo vive, la configuración manda.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query("set local role postgres");
      await c.query(
        `update public.rutero set fecha = app.hoy_lima() - 1 where id = $1`,
        [id("1", "62")],
      );
      await c.query("set local role authenticated");

      const p = await conParada(c, "62", "app.hoy_lima() - 1", "09:00");
      await llegaA(c, p, "62", horasEnElDia("- 1", "09:20"));
      const antes = await calcular(c, MES_ACTUAL);
      expect(antes?.cerrado_at).toBeNull();

      // Una config con tolerancia enorme: los 20 minutos pasan a ser puntuales.
      await c.query(
        `insert into public.config_perfect_merchandiser
           (tenant_id, peso_puntualidad, peso_asistencia, peso_tiempo_efectivo,
            peso_calidad, peso_herramientas, tolerancia_puntualidad_min,
            minutos_tardanza_cero, vigente_desde)
         values ($1, 25, 30, 0, 25, 20, 30, 90, ${MES_ACTUAL})`,
        [TENANTS.maracumango],
      );

      const despues = await calcular(c, MES_ACTUAL);
      expect(antes?.puntualidad_pct).toBe("88.89");
      expect(despues?.puntualidad_pct).toBe("100.00");
    });
  });

  it("calcular TARDE usa la configuración vigente al inicio del periodo", async () => {
    // Las reglas del juego se anuncian antes de jugar: una config publicada
    // después no puede cambiar un periodo ya empezado.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query(
        `insert into public.config_perfect_merchandiser
           (tenant_id, peso_puntualidad, peso_asistencia, peso_tiempo_efectivo,
            peso_calidad, peso_herramientas, tolerancia_puntualidad_min,
            minutos_tardanza_cero, vigente_desde)
         values ($1, 90, 10, 0, 0, 0, 60, 90, '2026-06-01')`,
        [TENANTS.maracumango],
      );
      const p = await conParada(c, "63", "'2026-02-10'::date", "09:00");
      await llegaA(c, p, "63", enLima("2026-02-10", "09:20"));

      // El periodo es febrero: manda la config de enero, no la de junio.
      const r = await calcular(c, MES_CERRADO);
      expect(r?.config_id).toBe(CONFIG_SEED);
      expect(r?.puntualidad_pct).toBe("88.89");
    });
  });
});

describe("la configuración y la escalera son inmutables", () => {
  it("ni siquiera un escritor privilegiado edita una configuración", async () => {
    // Dos verjas, y esta prueba la de dentro. Desde la app el UPDATE ni llega:
    // el grant de `authenticated` es solo select+insert (el caso de abajo). El
    // trigger es lo que protege el histórico de un `service_role` o de una
    // consola: los puntajes ya calculados apuntan a esta fila.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query("set local role postgres");
      await expect(
        c.query(
          `update public.config_perfect_merchandiser
             set peso_puntualidad = 50 where id = $1`,
          [CONFIG_SEED],
        ),
      ).rejects.toThrow(/no se edita/);
    });
  });

  it("un nivel de bono tampoco", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query("set local role postgres");
      await expect(
        c.query(
          `update public.nivel_bono_merchandiser set monto = 1
           where id = 'a0000022-0000-0000-0000-000000000001'`,
        ),
      ).rejects.toThrow(/no se edita/);
    });
  });

  it("desde la app el UPDATE ni siquiera tiene permiso", async () => {
    // El GRANT es la puerta: sin `update`, la petición muere antes de que el
    // trigger llegue a hablar.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await expect(
        c.query(
          `update public.config_perfect_merchandiser
             set peso_puntualidad = 50 where id = $1`,
          [CONFIG_SEED],
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("los pesos tienen que sumar 100", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await expect(
        c.query(
          `insert into public.config_perfect_merchandiser
             (tenant_id, peso_puntualidad, peso_asistencia, peso_tiempo_efectivo,
              peso_calidad, peso_herramientas, tolerancia_puntualidad_min,
              vigente_desde)
           values ($1, 10, 10, 0, 10, 10, 15, '2026-04-01')`,
          [TENANTS.maracumango],
        ),
      ).rejects.toMatchObject({ constraint: "config_pm_pesos_suman_100" });
    });
  });

  it("la rampa de tardanza no puede empezar antes que la tolerancia", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await expect(
        c.query(
          `insert into public.config_perfect_merchandiser
             (tenant_id, peso_puntualidad, peso_asistencia, peso_tiempo_efectivo,
              peso_calidad, peso_herramientas, tolerancia_puntualidad_min,
              minutos_tardanza_cero, vigente_desde)
           values ($1, 25, 25, 0, 25, 25, 30, 20, '2026-05-01')`,
          [TENANTS.maracumango],
        ),
      ).rejects.toMatchObject({ constraint: "config_pm_rampa_valida" });
    });
  });
});

describe("quién ve y quién dispara el puntaje", () => {
  async function sembrarPuntaje(c: Client): Promise<void> {
    const p = await conParada(c, "70", "'2026-02-10'::date", "09:00");
    await llegaA(c, p, "70", enLima("2026-02-10", "09:00"));
    await calcular(c, MES_CERRADO);
  }

  /** Cambia de usuario DENTRO de la misma transacción: dos bloques `comoUsuario`
   *  son dos transacciones y la primera revierte antes de que la segunda mire. */
  async function comoOtro(c: Client, userId: string): Promise<void> {
    await c.query(
      `set local request.jwt.claims = '${JSON.stringify({
        sub: userId,
        role: "authenticated",
        aal: "aal2",
      })}'`,
    );
  }

  async function cuenta(c: Client, tabla: string): Promise<number> {
    const r = await c.query<{ n: string }>(
      `select count(*)::text as n from public.${tabla}`,
    );
    return Number(r.rows[0]?.n ?? "0");
  }

  it("el mercaderista lee SU puntaje", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await sembrarPuntaje(c);
      await comoOtro(c, MERCADERISTA);
      expect(await cuenta(c, "puntaje_merchandiser")).toBe(1);
    });
  });

  it("el mercaderista NO lee el de un compañero", async () => {
    // Es un plan de lealtad individual: comparar sueldos entre pares no es lo
    // que el cliente compró.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await sembrarPuntaje(c);
      await c.query("set local role postgres");
      await c.query(
        `update public.puntaje_merchandiser set mercaderista_id = $1`,
        [USUARIOS.desvinculado],
      );
      await c.query("set local role authenticated");
      await comoOtro(c, MERCADERISTA);
      expect(await cuenta(c, "puntaje_merchandiser")).toBe(0);
    });
  });

  it("el cliente-marca no lee NADA de las tres tablas", async () => {
    // El plan de lealtad es la relación laboral entre la outsourcing y su
    // personal, no algo que la marca compre.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await sembrarPuntaje(c);
      await comoOtro(c, USUARIOS.clienteMaracumango);
      expect(await cuenta(c, "puntaje_merchandiser")).toBe(0);
      expect(await cuenta(c, "config_perfect_merchandiser")).toBe(0);
      expect(await cuenta(c, "nivel_bono_merchandiser")).toBe(0);
    });
  });

  it("el supervisor sí lee el puntaje: es quien lo revisa", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await sembrarPuntaje(c);
      await comoOtro(c, USUARIOS.supervisor);
      expect(await cuenta(c, "puntaje_merchandiser")).toBe(1);
    });
  });

  it("nadie escribe el puntaje desde la app: lo produce el servidor", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await expect(
        c.query(
          `insert into public.puntaje_merchandiser
             (mercaderista_id, tipo, periodo_inicio, tenant_id, config_id, total_pct)
           values ($1, 'mensual', '2026-02-01', $2, $3, 100)`,
          [MERCADERISTA, TENANTS.maracumango, CONFIG_SEED],
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("solo el admin publica configuración y niveles", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await expect(
        c.query(
          `insert into public.config_perfect_merchandiser
             (tenant_id, peso_puntualidad, peso_asistencia, peso_tiempo_efectivo,
              peso_calidad, peso_herramientas, tolerancia_puntualidad_min,
              vigente_desde)
           values ($1, 25, 25, 0, 25, 25, 15, '2026-09-01')`,
          [TENANTS.maracumango],
        ),
      ).rejects.toThrow();
    });
  });

  it("el mercaderista no dispara el recálculo de su propio bono", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await expect(
        c.query(
          `select public.recalcular_puntaje_merchandiser('mensual', '2026-02-01')`,
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("el staff recalcula el cliente entero y dice a cuántos alcanzó", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await c.query<{ recalcular_puntaje_merchandiser: number }>(
        `select public.recalcular_puntaje_merchandiser('mensual', '2026-02-01')`,
      );
      // Los mercaderistas del seed con tenant: el de Maracumango, el del rival y
      // el desvinculado (sigue siendo mercaderista de su cliente).
      expect(r.rows[0]!.recalcular_puntaje_merchandiser).toBeGreaterThan(0);
    });
  });
});
