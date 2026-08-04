import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, USUARIOS } from "./ayudas";

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
