import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// La MATEMÁTICA de los KPIs del dashboard (MAR-55) vive en SQL (dashboard_kpis):
// la partición actual/anterior, los guardas de división y el Share of Shelf. Se
// prueba por el camino real — el mercaderista inserta cadenas
// visita→levantamiento→levantamiento_sku fechadas en la ventana actual y en la
// anterior, y se llama a la función acotada por RLS a su tenant.
//
// La ventana vive en el año 2099, lejos del seed, para que SOLO cuenten las filas
// del test. Cada test corre en la transacción con rollback de `comoUsuario`.

const PARADA = "a0000009-0000-0000-0000-000000000001";
const TIENDA = "a0000002-0000-0000-0000-000000000001";
const MARCA = "cccccccc-0000-0000-0000-000000000001";
const SKU = "a0000003-0000-0000-0000-000000000001";

const DESDE = "2099-03-10";
const HASTA = "2099-03-20"; // período anterior = [2099-02-27, 2099-03-09]

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

type FilaKpis = {
  cumplimiento_pct: string | null;
  quiebres: string;
  quiebres_prev: string;
  diferencias: string;
  diferencias_prev: string;
  sos_pct: string | null;
  sos_pct_prev: string | null;
  desviaciones_precio: string;
  desviaciones_precio_prev: string;
};

/** Inserta una cadena fresca fechada en `checkIn`, como el mercaderista. */
async function levantar(
  c: Client,
  sufijo: string,
  datos: {
    checkIn: string;
    stockSistema?: number;
    stockPiso?: number;
    sosPropios?: number;
    sosCompetencia?: number;
  },
) {
  const visita = `d0000020-0000-0000-0000-0000000000${sufijo}`;
  const lev = `d0000021-0000-0000-0000-0000000000${sufijo}`;
  const ls = `d0000022-0000-0000-0000-0000000000${sufijo}`;
  await c.query(
    `insert into public.visita (id, rutero_parada_id, mercaderista_id, tienda_id, estado, check_in_at)
     values ($1,$2,$3,$4,'en_curso',$5)`,
    [visita, PARADA, USUARIOS.mercaderistaMaracumango, TIENDA, datos.checkIn],
  );
  const competencia =
    datos.sosCompetencia === undefined
      ? "[]"
      : JSON.stringify([
          { competidor: "Rival", frentes: datos.sosCompetencia },
        ]);
  await c.query(
    `insert into public.levantamiento
       (id, visita_id, marca_id, sos_frentes_propios, sos_frentes_competencia)
     values ($1,$2,$3,$4,$5::jsonb)`,
    [lev, visita, MARCA, datos.sosPropios ?? null, competencia],
  );
  if (datos.stockSistema !== undefined) {
    await c.query(
      `insert into public.levantamiento_sku
         (id, levantamiento_id, sku_id, stock_sistema, stock_piso)
       values ($1,$2,$3,$4,$5)`,
      [ls, lev, SKU, datos.stockSistema, datos.stockPiso ?? null],
    );
  }
  return visita;
}

async function kpis(
  c: Client,
  desde = DESDE,
  hasta = HASTA,
): Promise<FilaKpis> {
  const r = await c.query<FilaKpis>(
    "select * from public.dashboard_kpis($1,$2)",
    [desde, hasta],
  );
  const fila = r.rows[0];
  if (!fila) throw new Error("dashboard_kpis no devolvió fila");
  return fila;
}

describe("dashboard_kpis — partición actual vs. anterior", () => {
  it("cuenta quiebres y diferencias en su ventana, sin filtrar el previo a cero", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      // Ventana actual: un quiebre y una diferencia.
      await levantar(c, "a1", {
        checkIn: "2099-03-15T12:00:00Z",
        stockSistema: 10,
        stockPiso: 0,
      });
      await levantar(c, "a2", {
        checkIn: "2099-03-16T12:00:00Z",
        stockSistema: 10,
        stockPiso: 7,
      });
      // Ventana anterior: un quiebre.
      await levantar(c, "a3", {
        checkIn: "2099-03-05T12:00:00Z",
        stockSistema: 10,
        stockPiso: 0,
      });

      const f = await kpis(c);
      expect(Number(f.quiebres)).toBe(1);
      expect(Number(f.quiebres_prev)).toBe(1);
      expect(Number(f.diferencias)).toBe(1);
      expect(Number(f.diferencias_prev)).toBe(0);
    });
  });

  it("una visita en curso ya aporta sus hallazgos (no exige check-out)", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await levantar(c, "b1", {
        checkIn: "2099-03-15T12:00:00Z",
        stockSistema: 5,
        stockPiso: 0,
      });
      const f = await kpis(c);
      expect(Number(f.quiebres)).toBe(1);
    });
  });
});

describe("dashboard_kpis — Share of Shelf", () => {
  it("es propios / (propios + competencia) en porcentaje", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await levantar(c, "c1", {
        checkIn: "2099-03-15T12:00:00Z",
        sosPropios: 6,
        sosCompetencia: 4,
      });
      const f = await kpis(c);
      expect(Number(f.sos_pct)).toBe(60);
    });
  });
});

describe("dashboard_kpis — ventana sin datos", () => {
  it("devuelve contadores en 0 y porcentajes nulos", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const f = await kpis(c, "2099-06-01", "2099-06-10");
      expect(Number(f.quiebres)).toBe(0);
      expect(Number(f.diferencias)).toBe(0);
      expect(f.cumplimiento_pct).toBeNull();
      expect(f.sos_pct).toBeNull();
    });
  });
});

// El borde de la ventana: las 20:00 de Lima son las 01:00 UTC del día siguiente.
// Si la función resolviera el cast date→timestamptz con el TimeZone de la sesión
// (UTC), estas visitas contarían en el día equivocado.
describe("dashboard — la ventana es el día de LIMA, no el de UTC", () => {
  const VEINTE_HORAS_LIMA_DEL_20 = "2099-03-21T01:00:00Z";

  it("una visita a las 20:00 de Lima cae en su día, no en el siguiente", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      // Un quiebre (piso 0) y una diferencia (piso < sistema): cada columna
      // derivada tiene su propio filtro de ventana en el CTE `sku`.
      await levantar(c, "e1", {
        checkIn: VEINTE_HORAS_LIMA_DEL_20,
        stockSistema: 10,
        stockPiso: 0,
      });
      await levantar(c, "e5", {
        checkIn: VEINTE_HORAS_LIMA_DEL_20,
        stockSistema: 10,
        stockPiso: 7,
      });

      const suDia = await kpis(c, "2099-03-20", "2099-03-20");
      expect(Number(suDia.quiebres)).toBe(1);
      expect(Number(suDia.diferencias)).toBe(1);

      const elSiguiente = await kpis(c, "2099-03-21", "2099-03-21");
      expect(Number(elSiguiente.quiebres)).toBe(0);
      expect(Number(elSiguiente.diferencias)).toBe(0);
    });
  });

  it("el Share of Shelf resuelve actual y anterior con el mismo borde", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      // 20:00 de Lima del último día de la ventana actual → 60% actual.
      await levantar(c, "e6", {
        checkIn: VEINTE_HORAS_LIMA_DEL_20,
        sosPropios: 6,
        sosCompetencia: 4,
      });
      // 20:00 de Lima del último día del período anterior → 80% anterior.
      await levantar(c, "e7", {
        checkIn: "2099-03-10T01:00:00Z",
        sosPropios: 8,
        sosCompetencia: 2,
      });

      const f = await kpis(c);
      expect(Number(f.sos_pct)).toBe(60);
      expect(Number(f.sos_pct_prev)).toBe(80);
    });
  });

  it("las desviaciones de precio (alerta.creado_at) usan el mismo borde", async () => {
    const ACTUAL = "d0000023-0000-0000-0000-0000000000e8";
    const ANTERIOR = "d0000023-0000-0000-0000-0000000000e9";
    const VISITA_SEED = "a0000010-0000-0000-0000-000000000001";
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      // Las alertas las escribe el motor (service_role), no un usuario.
      await c.query("set local role postgres");
      for (const [id, creadoAt] of [
        [ACTUAL, VEINTE_HORAS_LIMA_DEL_20],
        [ANTERIOR, "2099-03-10T01:00:00Z"],
      ]) {
        await c.query(
          `insert into public.alerta
             (id, tenant_id, tipo, severidad, estado, marca_id, visita_id, payload, creado_at)
           values ($1, $2, 'desviacion_precio', 'info', 'nueva', $3, $4, '{}', $5)`,
          [id, TENANTS.maracumango, MARCA, VISITA_SEED, creadoAt],
        );
      }
      await c.query("set local role authenticated");

      const f = await kpis(c);
      expect(Number(f.desviaciones_precio)).toBe(1);
      expect(Number(f.desviaciones_precio_prev)).toBe(1);
    });
  });

  it("el período anterior (la tendencia) usa la misma resolución", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      // 20:00 de Lima del 9 de marzo: el ÚLTIMO día del período anterior a
      // [2099-03-10, 2099-03-20]. En UTC ya sería el 10, o sea el período actual.
      await levantar(c, "e2", {
        checkIn: "2099-03-10T01:00:00Z",
        stockSistema: 10,
        stockPiso: 0,
      });

      const f = await kpis(c);
      expect(Number(f.quiebres)).toBe(0);
      expect(Number(f.quiebres_prev)).toBe(1);
    });
  });

  it("dashboard_pines marca la tienda como visitada en su día de Lima", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await levantar(c, "e3", { checkIn: VEINTE_HORAS_LIMA_DEL_20 });

      const pin = async (desde: string, hasta: string) => {
        const r = await c.query<{
          visitada: boolean;
          ultima_visita_estado: string | null;
        }>(
          "select visitada, ultima_visita_estado from public.dashboard_pines($1,$2,null,$3)",
          [desde, hasta, TIENDA],
        );
        return r.rows[0];
      };

      const suDia = await pin("2099-03-20", "2099-03-20");
      expect(suDia?.visitada).toBe(true);
      expect(suDia?.ultima_visita_estado).toBe("en_curso");

      const elSiguiente = await pin("2099-03-21", "2099-03-21");
      expect(elSiguiente?.visitada).toBe(false);
      expect(elSiguiente?.ultima_visita_estado).toBeNull();
    });
  });

  it("dashboard_alertas cuenta la alerta en su día de Lima", async () => {
    const ALERTA = "d0000023-0000-0000-0000-0000000000e4";
    const VISITA_SEED = "a0000010-0000-0000-0000-000000000001";
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      // La alerta la escribe el motor (service_role), no un usuario.
      await c.query("set local role postgres");
      await c.query(
        `insert into public.alerta
           (id, tenant_id, tipo, severidad, estado, marca_id, visita_id, payload, creado_at)
         values ($1, $2, 'quiebre', 'info', 'nueva', $3, $4, '{}', $5)`,
        [
          ALERTA,
          TENANTS.maracumango,
          MARCA,
          VISITA_SEED,
          VEINTE_HORAS_LIMA_DEL_20,
        ],
      );
      await c.query("set local role authenticated");

      const feed = async (desde: string, hasta: string) => {
        const r = await c.query<{ id: string }>(
          "select id from public.dashboard_alertas($1,$2)",
          [desde, hasta],
        );
        return r.rows.map((f) => f.id);
      };

      expect(await feed("2099-03-20", "2099-03-20")).toContain(ALERTA);
      expect(await feed("2099-03-21", "2099-03-21")).not.toContain(ALERTA);

      // La misma alerta alimenta `tiene_alerta` en el pin de su tienda: el
      // borde tiene que coincidir con el del feed.
      const pinAlerta = async (desde: string, hasta: string) => {
        const r = await c.query<{ tiene_alerta: boolean }>(
          "select tiene_alerta from public.dashboard_pines($1,$2,null,$3)",
          [desde, hasta, TIENDA],
        );
        return r.rows[0];
      };
      expect((await pinAlerta("2099-03-20", "2099-03-20"))?.tiene_alerta).toBe(
        true,
      );
      expect((await pinAlerta("2099-03-21", "2099-03-21"))?.tiene_alerta).toBe(
        false,
      );
    });
  });
});
