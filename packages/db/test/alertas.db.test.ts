import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// El motor de alertas: triggers que producen `alerta` al insertar los datos de
// campo. Las alertas las escribe el SERVIDOR (SECURITY DEFINER) — authenticated
// no tiene INSERT en `alerta`. Se prueban por el camino real: el mercaderista
// inserta una cadena visita→levantamiento→levantamiento_sku y el trigger reacciona.
//
// Cada test monta una cadena FRESCA (ids nuevos) dentro de la transacción con
// rollback de comoUsuario, para no chocar con las unique del seed
// (levantamiento es único por visita+marca).

const PARADA = "a0000009-0000-0000-0000-000000000001";
const TIENDA = "a0000002-0000-0000-0000-000000000001";
const MARCA = "cccccccc-0000-0000-0000-000000000001";
const SKU = "a0000003-0000-0000-0000-000000000001"; // precio regular 6.90, tolerancia marca 5%

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

/** Inserta una cadena fresca como el mercaderista y devuelve el id de la visita. */
async function levantar(
  c: Client,
  sufijo: string,
  sku: {
    stock_sistema?: number;
    stock_piso?: number;
    precio_registrado?: number;
    hay_promo?: boolean;
    promo_comunicada?: boolean;
  },
) {
  const visita = `d0000010-0000-0000-0000-0000000000${sufijo}`;
  const lev = `d0000011-0000-0000-0000-0000000000${sufijo}`;
  const ls = `d0000012-0000-0000-0000-0000000000${sufijo}`;
  await c.query(
    `insert into public.visita (id, rutero_parada_id, mercaderista_id, tienda_id, estado, check_in_at)
     values ($1,$2,$3,$4,'en_curso', now())`,
    [visita, PARADA, USUARIOS.mercaderistaMaracumango, TIENDA],
  );
  await c.query(
    `insert into public.levantamiento (id, visita_id, marca_id) values ($1,$2,$3)`,
    [lev, visita, MARCA],
  );
  await c.query(
    `insert into public.levantamiento_sku
       (id, levantamiento_id, sku_id, stock_sistema, stock_piso, precio_registrado, hay_promo, promo_comunicada)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      ls,
      lev,
      SKU,
      sku.stock_sistema ?? null,
      sku.stock_piso ?? null,
      sku.precio_registrado ?? null,
      sku.hay_promo ?? null,
      sku.promo_comunicada ?? null,
    ],
  );
  return visita;
}

async function alertasDe(c: Client, visita: string) {
  const r = await c.query<{ tipo: string; payload: Record<string, unknown> }>(
    "select tipo, payload from public.alerta where visita_id = $1 order by tipo",
    [visita],
  );
  return r.rows;
}

describe("motor de alertas — stock", () => {
  it("un quiebre (piso 0, sistema > 0) genera alerta de quiebre", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const visita = await levantar(c, "a1", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      const tipos = (await alertasDe(c, visita)).map((a) => a.tipo);
      expect(tipos).toContain("quiebre");
    });
  });

  it("una diferencia (piso > 0 y ≠ sistema) genera alerta de diferencia_stock", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const visita = await levantar(c, "a2", {
        stock_sistema: 10,
        stock_piso: 7,
      });
      const tipos = (await alertasDe(c, visita)).map((a) => a.tipo);
      expect(tipos).toContain("diferencia_stock");
      expect(tipos).not.toContain("quiebre");
    });
  });
});

describe("motor de alertas — árbol de precios (regular 6.90, tolerancia 5%)", () => {
  it("precio muy por encima del regular → desviacion_precio (sobreprecio)", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const visita = await levantar(c, "b1", {
        stock_sistema: 5,
        stock_piso: 5,
        precio_registrado: 10.0,
      });
      const alertas = await alertasDe(c, visita);
      const precio = alertas.find((a) => a.tipo === "desviacion_precio");
      expect(precio?.payload.motivo).toBe("sobreprecio");
    });
  });

  it("precio por debajo del regular con promo vista pero no comunicada → promo_no_activa", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const visita = await levantar(c, "b2", {
        stock_sistema: 5,
        stock_piso: 5,
        precio_registrado: 4.0,
        hay_promo: true,
        promo_comunicada: false,
      });
      const tipos = (await alertasDe(c, visita)).map((a) => a.tipo);
      expect(tipos).toContain("promo_no_activa");
    });
  });

  it("precio dentro de la tolerancia del regular → sin alerta de precio", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const visita = await levantar(c, "b3", {
        stock_sistema: 5,
        stock_piso: 5,
        precio_registrado: 6.95,
      });
      const tipos = (await alertasDe(c, visita)).map((a) => a.tipo);
      expect(tipos).not.toContain("desviacion_precio");
      expect(tipos).not.toContain("promo_no_activa");
    });
  });
});

describe("motor de alertas — seguridad", () => {
  it("un usuario NO puede inyectar alertas llamando a crear_alerta directamente", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await expect(
        c.query(
          `select app.crear_alerta(
             'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'quiebre'::public.tipo_alerta,
             null, null, 'alta'::public.severidad_alerta, '{}'::jsonb)`,
        ),
      ).rejects.toThrow();
    });
  });
});

describe("alertas de staff: el cliente-marca no las ve", () => {
  // `verificacion_fotos` la levanta el guardarraíl del plan de lealtad y habla del
  // bono de un mercaderista: la relación laboral de la outsourcing con su
  // personal, no la operación de tienda que la marca compró. Quien lo impide es
  // la POLÍTICA, no la consulta que las agrupe — una alerta escondida solo en una
  // pantalla sigue siendo legible por PostgREST.
  const ALERTA = "d0000019-0000-0000-0000-000000000001";

  /** Siembra la alerta de staff como servidor y devuelve su id. */
  async function conAlertaDeStaff(c: Client): Promise<string> {
    await c.query("set local role postgres");
    await c.query(
      `insert into public.alerta (id, tenant_id, tipo, severidad, payload)
       values ($1, $2, 'verificacion_fotos', 'alta', '{}'::jsonb)`,
      [ALERTA, TENANTS.maracumango],
    );
    await c.query("set local role authenticated");
    return ALERTA;
  }

  async function laVe(c: Client, alerta: string): Promise<boolean> {
    const r = await c.query(`select 1 from public.alerta where id = $1`, [
      alerta,
    ]);
    return r.rowCount === 1;
  }

  it("el cliente-marca no la lee", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      const alerta = await conAlertaDeStaff(c);
      expect(await laVe(c, alerta)).toBe(false);
    });
  });

  it("el mercaderista tampoco: es su propio bono", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const alerta = await conAlertaDeStaff(c);
      expect(await laVe(c, alerta)).toBe(false);
    });
  });

  it("el staff sí la lee: es quien paga el bono", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const alerta = await conAlertaDeStaff(c);
      expect(await laVe(c, alerta)).toBe(true);
    });
  });

  it("el cliente-marca no puede marcarla como vista", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      const alerta = await conAlertaDeStaff(c);
      const r = await c.query(
        `update public.alerta set estado = 'vista' where id = $1`,
        [alerta],
      );
      // Sin filas afectadas: la política de UPDATE lleva el mismo predicado que
      // la de lectura. Dejarla con el viejo permitiría cambiarle el estado a una
      // alerta que no puede ni leer.
      expect(r.rowCount).toBe(0);
    });
  });

  it("las alertas de la operación de tienda las sigue viendo el cliente", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await c.query("set local role postgres");
      await c.query(
        `insert into public.alerta (id, tenant_id, tipo, severidad, payload)
         values ($1, $2, 'quiebre', 'alta', '{}'::jsonb)`,
        ["d0000019-0000-0000-0000-000000000002", TENANTS.maracumango],
      );
      await c.query("set local role authenticated");

      expect(await laVe(c, "d0000019-0000-0000-0000-000000000002")).toBe(true);
    });
  });
});
