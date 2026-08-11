import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// El ponderado total de Perfect Store, su renormalización y los agregados.
//
// La renormalización es lo que hace viable el piloto: entra con TRES de las cinco
// variables, y los pesos de las otras dos se reparten entre las evaluadas. Si en
// vez de repartirse contaran como cero, toda tienda del piloto tendría un techo
// del 80 % por variables que nadie mide todavía.

const IDS = {
  marca: "cccccccc-0000-0000-0000-000000000001",
  tienda: "a0000002-0000-0000-0000-000000000001",
  parada: "a0000009-0000-0000-0000-000000000001",
  sku: "a0000003-0000-0000-0000-000000000001",
  categoria: "a0000004-0000-0000-0000-000000000001",
  config: "a0000019-0000-0000-0000-000000000001",
} as const;

// Los pesos que siembra el seed para la configuración de marca.
const PESOS = {
  distribucion: 30,
  visibilidad: 25,
  precio: 25,
  pop: 10,
  orden: 10,
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

type Fila = {
  total_pct: string | null;
  distribucion_pct: string | null;
  visibilidad_pct: string | null;
  precio_pct: string | null;
};

/** Monta un levantamiento completo y devuelve su puntaje. */
async function puntuar(
  c: Client,
  sufijo: string,
  opciones: {
    sosPropios?: number | null;
    sosCompetencia?: number;
    skus?: { skuId?: string; quiebre?: [number, number]; precio?: number }[];
  } = {},
): Promise<Fila | null> {
  const visita = `e1000010-0000-0000-0000-0000000000${sufijo}`;
  const lev = `e1000011-0000-0000-0000-0000000000${sufijo}`;

  await comoOtro(c, USUARIOS.mercaderistaMaracumango, async () => {
    await c.query(
      `insert into public.visita (id, tenant_id, rutero_parada_id, mercaderista_id, tienda_id, estado, check_in_at)
       values ($1, $2, $3, $4, $5, 'en_curso', now())`,
      [
        visita,
        TENANTS.maracumango,
        IDS.parada,
        USUARIOS.mercaderistaMaracumango,
        IDS.tienda,
      ],
    );
    await c.query(
      `insert into public.levantamiento
         (id, tenant_id, visita_id, marca_id, sos_frentes_propios, sos_frentes_competencia)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        lev,
        TENANTS.maracumango,
        visita,
        IDS.marca,
        opciones.sosPropios ?? null,
        JSON.stringify(
          opciones.sosCompetencia === undefined
            ? []
            : [{ marca: "Rival", frentes: opciones.sosCompetencia }],
        ),
      ],
    );
    for (const s of opciones.skus ?? []) {
      await c.query(
        `insert into public.levantamiento_sku
           (tenant_id, levantamiento_id, sku_id, stock_sistema, stock_piso, precio_registrado)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          TENANTS.maracumango,
          lev,
          s.skuId ?? IDS.sku,
          s.quiebre?.[0] ?? null,
          s.quiebre?.[1] ?? null,
          s.precio ?? null,
        ],
      );
    }
    await c.query(
      `update public.levantamiento set estado = 'completado' where id = $1`,
      [lev],
    );
  });

  const r = await c.query<Fila>(
    `select total_pct, distribucion_pct, visibilidad_pct, precio_pct
     from public.puntaje_perfect_store where levantamiento_id = $1`,
    [lev],
  );
  return r.rows[0] ?? null;
}

describe("el ponderado renormaliza sobre lo evaluado", () => {
  it("con las tres variables del piloto, los pesos de POP y orden se reparten", async () => {
    // Distribución 100, visibilidad 100, precio 100 → 100, no 80. Si los pesos de
    // las dos variables que nadie mide contaran como cero, ninguna tienda del
    // piloto podría pasar del 80.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await puntuar(c, "01", {
        sosPropios: 35,
        sosCompetencia: 65,
        skus: [{ quiebre: [5, 5], precio: 6.9 }],
      });

      expect(Number(p?.distribucion_pct)).toBe(100);
      expect(Number(p?.visibilidad_pct)).toBe(100);
      expect(Number(p?.precio_pct)).toBe(100);
      expect(Number(p?.total_pct)).toBe(100);
    });
  });

  it("pondera de verdad: cada variable pesa lo que dice la configuración", async () => {
    // Distribución 0, visibilidad 100, precio 100, con pesos 30/25/25 sobre las
    // evaluadas → (0×30 + 100×25 + 100×25) / 80 = 62,5.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await puntuar(c, "02", {
        sosPropios: 35,
        sosCompetencia: 65,
        skus: [{ quiebre: [5, 0], precio: 6.9 }],
      });

      expect(Number(p?.distribucion_pct)).toBe(0);
      const esperado =
        (0 * PESOS.distribucion +
          100 * PESOS.visibilidad +
          100 * PESOS.precio) /
        (PESOS.distribucion + PESOS.visibilidad + PESOS.precio);
      expect(Number(p?.total_pct)).toBeCloseTo(esperado, 2);
    });
  });

  it("una variable NO evaluada reparte su peso, no puntúa cero", async () => {
    // Sin medición de SOS: visibilidad nula. Con distribución y precio al 100 el
    // total es 100 — si la visibilidad contara como cero, sería 66,7.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await puntuar(c, "03", {
        sosPropios: null,
        skus: [{ quiebre: [5, 5], precio: 6.9 }],
      });

      expect(p?.visibilidad_pct).toBeNull();
      expect(Number(p?.total_pct)).toBe(100);
    });
  });

  it("sin NINGUNA variable evaluada el total queda nulo, no en cero", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // Sin SOS y sin SKUs: no hay nada que puntuar.
      await c.query(
        `update public.tienda_sku set activo = false where tienda_id = $1`,
        [IDS.tienda],
      );
      const p = await puntuar(c, "04", { sosPropios: null });

      expect(p?.distribucion_pct).toBeNull();
      expect(p?.visibilidad_pct).toBeNull();
      expect(p?.precio_pct).toBeNull();
      expect(p?.total_pct).toBeNull();
    });
  });

  it("si las variables evaluadas pesan CERO, el total es nulo y no revienta", async () => {
    // El caso que dividiría por cero. Una configuración que pone todo el peso en
    // las dos variables que el piloto no evalúa es legítima —y absurda—, pero
    // tiene que dar "sin puntaje", no un error.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query(
        `insert into public.config_perfect_store
           (tenant_id, marca_id, peso_distribucion, peso_visibilidad, peso_precio,
            peso_pop, peso_orden, sos_objetivo_pct, vigente_desde)
         values ($1, $2, 0, 0, 0, 50, 50, 35, app.hoy_lima())`,
        [TENANTS.maracumango, IDS.marca],
      );

      const p = await puntuar(c, "05", {
        sosPropios: 35,
        sosCompetencia: 65,
        skus: [{ quiebre: [5, 5], precio: 6.9 }],
      });

      expect(Number(p?.distribucion_pct)).toBe(100);
      expect(p?.total_pct).toBeNull();
    });
  });
});

describe("el desglose por categoría", () => {
  it("no evalúa visibilidad y renormaliza su peso", async () => {
    // Hay una sola medición de share of shelf por visita: no se puede repartir
    // entre categorías sin inventarla. Con distribución y precio al 100, el
    // puntaje de la categoría es 100.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await puntuar(c, "06", {
        sosPropios: 35,
        sosCompetencia: 65,
        skus: [{ quiebre: [5, 5], precio: 6.9 }],
      });

      const r = await c.query<Fila & { categoria_id: string }>(
        `select categoria_id, total_pct, distribucion_pct, precio_pct
         from public.puntaje_perfect_store_categoria
         where levantamiento_id = 'e1000011-0000-0000-0000-000000000006'`,
      );

      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.categoria_id).toBe(IDS.categoria);
      expect(Number(r.rows[0]?.distribucion_pct)).toBe(100);
      expect(Number(r.rows[0]?.total_pct)).toBe(100);
    });
  });

  it("un SKU sin categoría cuenta en el total pero no en ningún corte", async () => {
    // No se le puede atribuir una. La diferencia entre los codificados del total
    // y la suma de los codificados por categoría es donde se ve.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query(
        `insert into public.sku (id, tenant_id, marca_id, codigo, nombre)
         values ('e1000003-0000-0000-0000-000000000099', $1, $2, 'SIN-CAT', 'Sin categoría')`,
        [TENANTS.maracumango, IDS.marca],
      );
      await c.query(
        `insert into public.tienda_sku (tenant_id, tienda_id, sku_id)
         values ($1, $2, 'e1000003-0000-0000-0000-000000000099')`,
        [TENANTS.maracumango, IDS.tienda],
      );

      await puntuar(c, "07", {
        skus: [
          { quiebre: [5, 5] },
          { skuId: "e1000003-0000-0000-0000-000000000099", quiebre: [5, 0] },
        ],
      });

      const total = await c.query<{ skus_codificados: number }>(
        `select skus_codificados from public.puntaje_perfect_store
         where levantamiento_id = 'e1000011-0000-0000-0000-000000000007'`,
      );
      const porCategoria = await c.query<{ suma: string }>(
        `select coalesce(sum(skus_codificados), 0)::text as suma
         from public.puntaje_perfect_store_categoria
         where levantamiento_id = 'e1000011-0000-0000-0000-000000000007'`,
      );

      expect(total.rows[0]?.skus_codificados).toBe(2);
      expect(Number(porCategoria.rows[0]?.suma)).toBe(1);
    });
  });

  it("recalcular RETIRA la categoría que dejó de tener SKUs codificados", async () => {
    // Con un upsert se quedaría ahí para siempre con datos viejos.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await puntuar(c, "08", { skus: [{ quiebre: [5, 5] }] });

      const antes = await c.query(
        `select 1 from public.puntaje_perfect_store_categoria
         where levantamiento_id = 'e1000011-0000-0000-0000-000000000008'`,
      );
      expect(antes.rowCount).toBe(1);

      await c.query(
        `update public.tienda_sku set activo = false where tienda_id = $1`,
        [IDS.tienda],
      );
      await c.query(
        `select app.calcular_puntaje_perfect_store('e1000011-0000-0000-0000-000000000008')`,
      );

      const despues = await c.query(
        `select 1 from public.puntaje_perfect_store_categoria
         where levantamiento_id = 'e1000011-0000-0000-0000-000000000008'`,
      );
      expect(despues.rowCount).toBe(0);
    });
  });
});

describe("los agregados", () => {
  it("promedia los levantamientos de la ventana", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // Uno al 100 y otro con la distribución a cero.
      await puntuar(c, "09", {
        sosPropios: 35,
        sosCompetencia: 65,
        skus: [{ quiebre: [5, 5], precio: 6.9 }],
      });
      await puntuar(c, "10", {
        sosPropios: 35,
        sosCompetencia: 65,
        skus: [{ quiebre: [5, 0], precio: 6.9 }],
      });

      const r = await c.query<{ levantamientos: string; total_pct: string }>(
        `select levantamientos, total_pct
         from public.perfect_store_agregado(app.hoy_lima(), app.hoy_lima())`,
      );

      expect(Number(r.rows[0]?.levantamientos)).toBe(2);
      // (100 + 62,5) / 2
      expect(Number(r.rows[0]?.total_pct)).toBeCloseTo(81.25, 1);
    });
  });

  it("una ventana anterior no incluye lo de hoy", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await puntuar(c, "11", { skus: [{ quiebre: [5, 5] }] });

      const r = await c.query<{ levantamientos: string }>(
        `select levantamientos from public.perfect_store_agregado(
           app.hoy_lima() - 10, app.hoy_lima() - 1)`,
      );
      expect(Number(r.rows[0]?.levantamientos)).toBe(0);
    });
  });

  it("con categoría devuelve el desglose, SIN visibilidad", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await puntuar(c, "12", {
        sosPropios: 35,
        sosCompetencia: 65,
        skus: [{ quiebre: [5, 5], precio: 6.9 }],
      });

      const r = await c.query<{
        levantamientos: string;
        visibilidad_pct: string | null;
        distribucion_pct: string;
      }>(
        `select levantamientos, visibilidad_pct, distribucion_pct
         from public.perfect_store_agregado(
           app.hoy_lima(), app.hoy_lima(), null, $1)`,
        [IDS.categoria],
      );

      expect(Number(r.rows[0]?.levantamientos)).toBe(1);
      expect(r.rows[0]?.visibilidad_pct).toBeNull();
      expect(Number(r.rows[0]?.distribucion_pct)).toBe(100);
    });
  });

  it("filtra por tipo de tienda", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query(
        `update public.cadena set tipo_tienda = 'hiper' where id = $1`,
        ["a0000001-0000-0000-0000-000000000001"],
      );
      await puntuar(c, "13", { skus: [{ quiebre: [5, 5] }] });

      const hiper = await c.query<{ levantamientos: string }>(
        `select levantamientos from public.perfect_store_agregado(
           app.hoy_lima(), app.hoy_lima(), null, null, 'hiper')`,
      );
      const express = await c.query<{ levantamientos: string }>(
        `select levantamientos from public.perfect_store_agregado(
           app.hoy_lima(), app.hoy_lima(), null, null, 'express')`,
      );

      expect(Number(hiper.rows[0]?.levantamientos)).toBe(1);
      expect(Number(express.rows[0]?.levantamientos)).toBe(0);
    });
  });

  it("el cliente-marca solo agrega LO SUYO: lo acota la RLS", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await puntuar(c, "14", { skus: [{ quiebre: [5, 5] }] });
    });

    await comoUsuario(db, USUARIOS.mercaderistaRival, async (c) => {
      const r = await c.query<{ levantamientos: string }>(
        `select levantamientos from public.perfect_store_agregado(
           app.hoy_lima() - 30, app.hoy_lima())`,
      );
      expect(Number(r.rows[0]?.levantamientos)).toBe(0);
    });
  });
});
