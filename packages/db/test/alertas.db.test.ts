import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CASOS_PRECIO } from "../src/casos-precio";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// El motor de alertas: triggers que producen `alerta` a partir de los datos de
// campo. Las escribe el SERVIDOR (SECURITY DEFINER) — `authenticated` no tiene
// INSERT en `alerta`.
//
// Se prueban por el CAMINO REAL del móvil, y eso es lo que cambió: este fichero
// insertaba la fila de `levantamiento_sku` entera en un solo statement, un camino
// que la app nunca toma. El wizard la escribe en tres pasadas —"Antes + SOS" la
// crea con solo `frentes_propios`, y el stock y el precio llegan como UPDATE—, y
// contra un trigger `after insert` eso significaba que el motor no veía jamás el
// dato. El test pasaba en verde probando el árbol de decisión sobre una fila que
// la realidad nunca produce.
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

type CamposSku = {
  stock_sistema?: number | null;
  stock_piso?: number | null;
  precio_registrado?: number | null;
  hay_promo?: boolean | null;
  promo_comunicada?: boolean | null;
};

type Cadena = { visita: string; levantamientoSku: string };

/**
 * Recorre el camino real del wizard y devuelve la cadena creada.
 *
 * Tres escrituras, como `upsertLevantamientoSku`: el paso "Antes + SOS" CREA la
 * fila con solo `frentes_propios`, y el stock y el precio llegan como UPDATE. Un
 * `insert` con todo relleno de una vez es el camino que este fichero tomaba
 * antes, y por el que el motor parecía funcionar.
 */
async function levantar(
  c: Client,
  sufijo: string,
  sku: CamposSku,
): Promise<Cadena> {
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
  // Paso 1 — "Antes + SOS": solo los frentes.
  await c.query(
    `insert into public.levantamiento_sku (id, levantamiento_id, sku_id, frentes_propios)
     values ($1,$2,$3,4)`,
    [ls, lev, SKU],
  );

  const cadena = { visita, levantamientoSku: ls };
  // Paso 2 — "Quiebres y diferencias".
  if (sku.stock_sistema !== undefined || sku.stock_piso !== undefined) {
    await pasoActualiza(c, cadena, {
      stock_sistema: sku.stock_sistema,
      stock_piso: sku.stock_piso,
    });
  }
  // Paso 3 — "Precios".
  if (sku.precio_registrado !== undefined) {
    await pasoActualiza(c, cadena, {
      precio_registrado: sku.precio_registrado,
      hay_promo: sku.hay_promo ?? null,
      promo_comunicada: sku.promo_comunicada ?? null,
    });
  }
  return cadena;
}

/** Un paso posterior del wizard: UPDATE sobre la fila que creó el paso SOS. */
async function pasoActualiza(
  c: Client,
  cadena: Cadena,
  campos: CamposSku,
): Promise<void> {
  const cols = Object.keys(campos);
  const vals = Object.values(campos);
  await c.query(
    `update public.levantamiento_sku
        set ${cols.map((col, i) => `${col} = $${i + 2}`).join(", ")}
      where id = $1`,
    [cadena.levantamientoSku, ...vals],
  );
}

async function alertasDe(c: Client, visita: string) {
  const r = await c.query<{
    tipo: string;
    estado: string;
    payload: Record<string, unknown>;
  }>(
    `select tipo, estado, payload from public.alerta
      where visita_id = $1 order by tipo`,
    [visita],
  );
  return r.rows;
}

describe("motor de alertas — stock", () => {
  it("un quiebre (piso 0, sistema > 0) genera alerta de quiebre", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const { visita } = await levantar(c, "a1", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      const tipos = (await alertasDe(c, visita)).map((a) => a.tipo);
      expect(tipos).toContain("quiebre");
    });
  });

  it("una diferencia (piso > 0 y ≠ sistema) genera alerta de diferencia_stock", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const { visita } = await levantar(c, "a2", {
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
      const { visita } = await levantar(c, "b1", {
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
      const { visita } = await levantar(c, "b2", {
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
      const { visita } = await levantar(c, "b3", {
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

describe("el corpus del árbol de precio, contra la BASE", () => {
  // El MISMO fichero de casos que ejecuta el espejo del móvil
  // (`apps/mobile/src/lib/hallazgos.test.ts`). Es la única verja real contra la
  // divergencia entre las dos implementaciones: si el SQL cambia y el espejo no
  // —o al revés— uno de los dos lados se pone rojo. Ver docs/adr/0012.
  //
  // Corre con el cliente crudo y no con `comoUsuario`: siembra periodos de
  // precio, y para eso hay que borrar los del seed — cosa que ningún rol de la
  // app puede hacer, a propósito. Lo que se prueba aquí es la ARITMÉTICA de la
  // función, no quién puede llamarla; de eso responden los tests de privilegios.

  const CADENA = "a0000001-0000-0000-0000-000000000001";

  it.each(CASOS_PRECIO.map((c) => [c.nombre, c] as const))(
    "%s",
    async (_nombre, caso) => {
      await db.query("begin");
      try {
        await db.query(
          `delete from public.precio_regular where tenant_id = $1 and sku_id = $2`,
          [TENANTS.maracumango, SKU],
        );
        await db.query(
          `delete from public.promocion where tenant_id = $1 and sku_id = $2`,
          [TENANTS.maracumango, SKU],
        );
        await db.query(
          `update public.marca set tolerancia_precio_pct = $2 where id = $1`,
          [MARCA, caso.tolerancia_pct],
        );

        for (const p of caso.periodos) {
          await db.query(
            `insert into public.precio_regular
               (tenant_id, sku_id, cadena_id, tipo_tienda, precio, vigente_desde,
                vigente_hasta)
             values ($1,$2,$3,$4::public.tipo_tienda,$5,$6,$7)`,
            [
              TENANTS.maracumango,
              SKU,
              CADENA,
              p.tipo_tienda,
              p.precio,
              p.vigente_desde,
              p.vigente_hasta,
            ],
          );
        }
        for (const pr of caso.promociones) {
          await db.query(
            `insert into public.promocion
               (tenant_id, sku_id, precio_promo, fecha_inicio, fecha_fin, comunicada)
             values ($1,$2,$3,$4,$5,$6)`,
            [
              TENANTS.maracumango,
              SKU,
              pr.precio_promo,
              pr.fecha_inicio,
              pr.fecha_fin,
              pr.comunicada,
            ],
          );
        }

        const r = await db.query<{
          veredicto: string;
          precio_regular: string | null;
        }>(
          `select veredicto, precio_regular::text
             from app.evaluar_precio_sku($1,$2,$3,$4,$5,$6,$7,$8::date)`,
          [
            TENANTS.maracumango,
            SKU,
            MARCA,
            CADENA,
            caso.precio_registrado,
            caso.hay_promo,
            caso.promo_comunicada,
            caso.fecha,
          ],
        );

        expect(r.rows[0]?.veredicto).toBe(caso.espera);
        const regular = r.rows[0]?.precio_regular;
        expect(
          regular === null || regular === undefined ? null : Number(regular),
        ).toBe(caso.esperaRegular);
      } finally {
        await db.query("rollback");
      }
    },
  );
});

describe("el precio de ayer no lo cambia el precio de hoy", () => {
  // La regresión que el cliente describió con nombre y apellido: "el precio
  // promedio de 2025 y el de 2026 — si yo lo modifico y después me bajo el
  // reporte, me va a salir como si no hubiese variado".
  //
  // Se prueba sobre `app.evaluar_precio_sku` y no sobre una visita entera porque
  // es ahí donde vive la resolución por fecha: el reporte reevalúa con la fecha
  // de la visita, meses después.

  const CADENA = "a0000001-0000-0000-0000-000000000001";

  async function evaluar(c: Client, fecha: string) {
    const r = await c.query<{
      veredicto: string;
      precio_regular: string | null;
    }>(
      `select veredicto, precio_regular::text
         from app.evaluar_precio_sku($1, $2, $3, $4, 7.20, false, false, $5::date)`,
      [TENANTS.maracumango, SKU, MARCA, CADENA, fecha],
    );
    return r.rows[0];
  }

  it("abrir un periodo nuevo NO altera la evaluación de una visita anterior", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const antes = await evaluar(c, "2026-06-15");
      expect(Number(antes?.precio_regular)).toBe(6.9);

      await c.query(
        `select public.abrir_periodo_precio(p_sku := $1, p_cadena := $2,
                 p_precio := 9.90, p_vigente_desde := '2027-01-01')`,
        [SKU, CADENA],
      );

      // Pasada la fecha nueva rige el nuevo.
      const despuesDelCambio = await evaluar(c, "2027-02-15");
      expect(Number(despuesDelCambio?.precio_regular)).toBe(9.9);

      // Y junio sigue diciendo exactamente lo mismo que decía.
      const despues = await evaluar(c, "2026-06-15");
      expect(Number(despues?.precio_regular)).toBe(6.9);
      expect(despues?.veredicto).toBe(antes?.veredicto);
    });
  });

  it("un periodo CERRADO deja de resolver para una fecha posterior a su fin", async () => {
    // Sin que el resolvedor mire `vigente_hasta`, el periodo cerrado seguiría
    // ganando y las alertas se dispararían contra un precio derogado.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query(
        `update public.precio_regular set vigente_hasta = '2027-06-30'
          where tenant_id = $1 and sku_id = $2 and cadena_id = $3`,
        [TENANTS.maracumango, SKU, CADENA],
      );

      expect(Number((await evaluar(c, "2027-06-15"))?.precio_regular)).toBe(
        6.9,
      );
      const fuera = await evaluar(c, "2027-07-15");
      expect(fuera?.precio_regular).toBeNull();
      expect(fuera?.veredicto).toBe("sin_precio_vigente");
    });
  });

  it("abrir un periodo deja DOS filas: la anterior cerrada y ninguna retirada", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query(
        `select public.abrir_periodo_precio(p_sku := $1, p_cadena := $2,
                 p_precio := 9.90, p_vigente_desde := '2027-01-01')`,
        [SKU, CADENA],
      );

      const r = await c.query<{
        precio: string;
        vigente_desde: string;
        vigente_hasta: string | null;
      }>(
        `select precio::text, vigente_desde::text, vigente_hasta::text
           from public.precio_regular
          where tenant_id = $1 and sku_id = $2 and cadena_id = $3
          order by vigente_desde`,
        [TENANTS.maracumango, SKU, CADENA],
      );

      expect(r.rows).toHaveLength(2);
      expect(r.rows[0]?.vigente_hasta).toBe("2026-12-31");
      expect(Number(r.rows[0]?.precio)).toBe(6.9);
      expect(r.rows[1]?.vigente_hasta).toBeNull();
    });
  });

  it("abrir un periodo con una fecha PASADA se rechaza: reescribiría lo evaluado", async () => {
    // Sin la guarda, el operador vería el 23514 crudo del check de coherencia y
    // no sabría qué hizo mal.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await expect(
        c.query(
          `select public.abrir_periodo_precio(p_sku := $1, p_cadena := $2,
                 p_precio := 9.90, p_vigente_desde := '2026-01-01')`,
          [SKU, CADENA],
        ),
      ).rejects.toThrow(/reescribiría lo que ya se evaluó/);
    });
  });

  it("el precio de un periodo que ya empezó no se puede reescribir", async () => {
    // La verja vive en la BASE y no solo en la Server Action: `authenticated`
    // tiene UPDATE sobre la tabla y un PATCH directo a PostgREST se saltaría
    // cualquier comprobación que viviera solo en el panel.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await expect(
        c.query(
          `update public.precio_regular set precio = 99
            where tenant_id = $1 and sku_id = $2 and cadena_id = $3`,
          [TENANTS.maracumango, SKU, CADENA],
        ),
      ).rejects.toThrow(/no se puede reescribir/);
    });
  });

  it("cerrar ese mismo periodo SÍ se puede: es la operación legítima", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query(
        `update public.precio_regular set vigente_hasta = '2026-12-31'
          where tenant_id = $1 and sku_id = $2 and cadena_id = $3`,
        [TENANTS.maracumango, SKU, CADENA],
      );
      const r = await c.query<{ vigente_hasta: string }>(
        `select vigente_hasta::text from public.precio_regular
          where tenant_id = $1 and sku_id = $2 and cadena_id = $3`,
        [TENANTS.maracumango, SKU, CADENA],
      );
      expect(r.rows[0]?.vigente_hasta).toBe("2026-12-31");
    });
  });

  it("un periodo que aún NO ha empezado sí se corrige en sitio", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query(
        `select public.abrir_periodo_precio(p_sku := $1, p_cadena := $2,
                 p_precio := 9.90, p_vigente_desde := '2027-01-01')`,
        [SKU, CADENA],
      );
      await c.query(
        `update public.precio_regular set precio = 10.5
          where tenant_id = $1 and sku_id = $2 and vigente_desde = '2027-01-01'`,
        [TENANTS.maracumango, SKU],
      );
      const r = await c.query<{ precio: string }>(
        `select precio::text from public.precio_regular
          where tenant_id = $1 and sku_id = $2 and vigente_desde = '2027-01-01'`,
        [TENANTS.maracumango, SKU],
      );
      expect(Number(r.rows[0]?.precio)).toBe(10.5);
    });
  });

  it("un periodo abierto no se corta hacia atrás: dejaría el tramo sin precio", async () => {
    // Un tramo sin precio vigente no da error en ninguna pantalla: da
    // `sin_precio_vigente`, o sea que el SKU sale del denominador de Perfect
    // Store en silencio, con forma de dato que falta.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await expect(
        c.query(
          `update public.precio_regular set vigente_hasta = '2026-06-30'
            where tenant_id = $1 and sku_id = $2 and cadena_id = $3`,
          [TENANTS.maracumango, SKU, CADENA],
        ),
      ).rejects.toThrow(/sin precio vigente/);
    });
  });

  it("pero SÍ justo antes de que arranque el siguiente: eso es encadenar", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query(
        `select public.abrir_periodo_precio(p_sku := $1, p_cadena := $2,
                 p_precio := 9.90, p_vigente_desde := '2027-01-01')`,
        [SKU, CADENA],
      );
      // `abrir_periodo_precio` ya lo dejó en 2026-12-31; reafirmarlo es la misma
      // escritura que hace el importador al encadenar una cadena de periodos.
      await c.query(
        `update public.precio_regular set vigente_hasta = '2026-12-31'
          where tenant_id = $1 and sku_id = $2 and vigente_desde = '2026-01-01'`,
        [TENANTS.maracumango, SKU],
      );
    });
  });

  it("un periodo ya cerrado EN EL PASADO no se reabre", async () => {
    // Reabrirlo cambiaría lo que ese tramo dice hoy, y el portal recalcula la
    // ventana de una alerta vieja cada vez que se abre.
    //
    // El periodo se siembra en el bucket de `hiper`, que está vacío: así lo
    // único que puede rechazar el UPDATE es el trigger, y no la restricción de
    // solapamiento. Uno cerrado en el FUTURO sí se puede mover — no hay pasado
    // que reescribir— y de eso responde la exclusión, no esta verja.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query(
        `insert into public.precio_regular
           (tenant_id, sku_id, cadena_id, tipo_tienda, precio, vigente_desde,
            vigente_hasta)
         values ($1, $2, $3, 'hiper', 5.0, '2026-02-01', '2026-03-31')`,
        [TENANTS.maracumango, SKU, CADENA],
      );

      await expect(
        c.query(
          `update public.precio_regular set vigente_hasta = null
            where tenant_id = $1 and sku_id = $2 and tipo_tienda = 'hiper'`,
          [TENANTS.maracumango, SKU],
        ),
      ).rejects.toThrow(/ya no se reabre/);
    });
  });

  it("ningún rol puede BORRAR un precio: no hay GRANT de delete", async () => {
    // El histórico no se protege solo con la política: `precio_admin_escribe` es
    // `for all`, y lo que impide el borrado es que el GRANT solo da
    // `insert, update`. Nada lo vigilaba hasta ahora.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await expect(
        c.query(
          `delete from public.precio_regular
            where tenant_id = $1 and sku_id = $2`,
          [TENANTS.maracumango, SKU],
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });
});

describe("la promoción que ya arrancó tampoco se reescribe", () => {
  // El bug gemelo, en otra tabla: cambiar `comunicada` de una promo de julio en
  // septiembre cambia el veredicto de una visita de julio.
  it("cambiar `comunicada` de una promo que ya arrancó se rechaza", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await expect(
        c.query(
          `update public.promocion set comunicada = true
            where tenant_id = $1 and sku_id = $2`,
          [TENANTS.maracumango, SKU],
        ),
      ).rejects.toThrow(/ya arrancó/);
    });
  });

  // Una transacción por caso: el primer rechazo la aborta, y una segunda
  // consulta en la misma solo devolvería 25P02 — un verde o un rojo que no
  // hablan de lo que se quería probar.
  it.each([
    [
      "estirarla hacia adelante cubriría meses ya evaluados SIN ella",
      "2026-12-31",
    ],
    ["acortarla hacia atrás descubriría días que sí la tuvieron", "2026-01-05"],
  ])(
    "una promo que YA TERMINÓ no mueve su vigencia: %s",
    async (_caso, fin) => {
      // La del seed va del 1 al 31 de julio: ya acabó.
      await comoUsuario(db, USUARIOS.admin, async (c) => {
        await expect(
          c.query(
            `update public.promocion set fecha_fin = $3
            where tenant_id = $1 and sku_id = $2`,
            [TENANTS.maracumango, SKU, fin],
          ),
        ).rejects.toThrow(/ya no se mueve/);
      });
    },
  );
});

describe("motor de alertas — un hallazgo, una alerta", () => {
  it("el camino real del wizard levanta la alerta que antes no salía", async () => {
    // El bug entero, en un test: con el trigger atado solo al INSERT, el motor
    // veía la fila cuando `stock_piso` todavía era NULL y no producía nada.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const { visita } = await levantar(c, "c1", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      const alertas = await alertasDe(c, visita);
      expect(alertas.map((a) => a.tipo)).toEqual(["quiebre"]);
    });
  });

  it("el paso SOS por sí solo no levanta nada: todavía no hay hallazgo", async () => {
    // El caso negativo. Sin él, un motor que alertara de todo pasaría el de
    // arriba sin enterarse.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const { visita } = await levantar(c, "c2", {});
      expect(await alertasDe(c, visita)).toEqual([]);
    });
  });

  it("reentrar al paso y volver a guardar no duplica la alerta", async () => {
    // Sin clave natural, cada pasada del wizard dejaba una alerta más: tres
    // `quiebre` del mismo SKU en la bandeja del supervisor.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantar(c, "c3", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      await pasoActualiza(c, cadena, { stock_sistema: 10, stock_piso: 0 });
      await pasoActualiza(c, cadena, { stock_sistema: 10, stock_piso: 0 });
      expect(await alertasDe(c, cadena.visita)).toHaveLength(1);
    });
  });

  it("el quiebre y la desviación de precio conviven: son hallazgos distintos", async () => {
    // La clave lleva el `tipo`, así que dedupe no significa "una alerta por
    // SKU": significa una por hallazgo.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const { visita } = await levantar(c, "c4", {
        stock_sistema: 10,
        stock_piso: 0,
        precio_registrado: 10.0,
      });
      const tipos = (await alertasDe(c, visita)).map((a) => a.tipo).sort();
      expect(tipos).toEqual(["desviacion_precio", "quiebre"]);
    });
  });

  it("mientras sigue NUEVA, el payload se refresca con los números de ahora", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantar(c, "c5", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      await pasoActualiza(c, cadena, { stock_sistema: 15, stock_piso: 0 });
      const alertas = await alertasDe(c, cadena.visita);
      expect(alertas).toHaveLength(1);
      expect(alertas[0]?.payload.stock_sistema).toBe(15);
    });
  });

  it("una alerta ya VISTA no se le cambia el payload por debajo", async () => {
    // El supervisor la miró sobre unos números concretos. Refrescárselos le
    // cambiaría la evidencia de una decisión que ya tomó.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantar(c, "c6", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      await c.query("set local role postgres");
      await c.query(
        `update public.alerta set estado = 'vista' where visita_id = $1`,
        [cadena.visita],
      );
      await c.query("set local role authenticated");

      await pasoActualiza(c, cadena, { stock_sistema: 15, stock_piso: 0 });
      const alertas = await alertasDe(c, cadena.visita);
      expect(alertas[0]?.payload.stock_sistema).toBe(10);
    });
  });
});

describe("motor de alertas — el hallazgo que deja de existir", () => {
  it("corregir el stock anula la alerta", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantar(c, "d1", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      await pasoActualiza(c, cadena, { stock_sistema: 10, stock_piso: 10 });
      const alertas = await alertasDe(c, cadena.visita);
      expect(alertas.map((a) => a.estado)).toEqual(["anulada"]);
    });
  });

  it("corregir el precio anula la alerta de precio", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantar(c, "d2", { precio_registrado: 10.0 });
      await pasoActualiza(c, cadena, { precio_registrado: 6.9 });
      const alertas = await alertasDe(c, cadena.visita);
      expect(alertas.map((a) => a.estado)).toEqual(["anulada"]);
    });
  });

  it("si el hallazgo vuelve, la alerta anulada se reabre como NUEVA", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantar(c, "d3", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      await pasoActualiza(c, cadena, { stock_sistema: 10, stock_piso: 10 });
      await pasoActualiza(c, cadena, { stock_sistema: 10, stock_piso: 0 });
      const alertas = await alertasDe(c, cadena.visita);
      expect(alertas).toHaveLength(1);
      expect(alertas[0]?.estado).toBe("nueva");
    });
  });

  it("una alerta que el supervisor ya miró NO se anula sola", async () => {
    // `vista` significa que hay una persona con esto en su bandeja de trabajo.
    // Quitárselo de la vista por debajo le esconde algo sobre lo que quizá ya
    // actuó; cerrarla es decisión suya.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantar(c, "d4", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      await c.query("set local role postgres");
      await c.query(
        `update public.alerta set estado = 'vista' where visita_id = $1`,
        [cadena.visita],
      );
      await c.query("set local role authenticated");

      await pasoActualiza(c, cadena, { stock_sistema: 10, stock_piso: 10 });
      const alertas = await alertasDe(c, cadena.visita);
      expect(alertas.map((a) => a.estado)).toEqual(["vista"]);
    });
  });

  it("borrar el precio anula las dos alertas de precio", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantar(c, "d5", {
        precio_registrado: 4.0,
        hay_promo: true,
        promo_comunicada: false,
      });
      expect((await alertasDe(c, cadena.visita)).map((a) => a.tipo)).toEqual([
        "promo_no_activa",
      ]);

      await pasoActualiza(c, cadena, { precio_registrado: null });
      const alertas = await alertasDe(c, cadena.visita);
      expect(alertas.map((a) => a.estado)).toEqual(["anulada"]);
    });
  });
});

describe("motor de alertas — lo que NO se deduplica", () => {
  it("dos contingencias de la misma visita son dos alertas", async () => {
    // La clave es parcial (`where sku_id is not null`) justo por esto: una
    // visita tiene legítimamente una contingencia por paso omitido, y una única
    // sobre `(tenant, visita, tipo)` las habría colapsado en una.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantar(c, "e1", {});
      for (const paso of ["precios", "exhibiciones"]) {
        await c.query(
          `insert into public.contingencia (tenant_id, visita_id, paso, motivo, registrada_at)
           values ($1, $2, $3, 'harness', now())`,
          [TENANTS.maracumango, cadena.visita, paso],
        );
      }
      const tipos = (await alertasDe(c, cadena.visita)).map((a) => a.tipo);
      expect(tipos).toEqual(["contingencia", "contingencia"]);
    });
  });
});

describe("`anulada` la escribe el motor, y lo dice la POLÍTICA", () => {
  // El portal no ofrece el botón, pero eso es UX. El grant deja escribir la
  // columna `estado`, así que sin verja en la política un cliente-marca podría
  // marcar `anulada` por PostgREST y esconder de la bandeja un hallazgo que
  // nadie corrigió — justo la integridad que este ticket devuelve.
  async function conAlerta(c: Client, sufijo: string) {
    const { visita } = await levantar(c, sufijo, {
      stock_sistema: 10,
      stock_piso: 0,
    });
    return visita;
  }

  it("el cliente-marca NO puede marcar una alerta como anulada", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const visita = await conAlerta(c, "f1");
      await c.query("set local role postgres");
      await c.query(
        `set local request.jwt.claims = '${JSON.stringify({
          sub: USUARIOS.clienteMaracumango,
          role: "authenticated",
          aal: "aal2",
        })}'`,
      );
      await c.query("set local role authenticated");

      await expect(
        c.query(
          `update public.alerta set estado = 'anulada' where visita_id = $1`,
          [visita],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("el staff tampoco: el estado significa que el DATO dejó de existir", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await expect(
        c.query(`update public.alerta set estado = 'anulada' where true`),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("el ciclo normal de triage sigue funcionando", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const visita = await conAlerta(c, "f3");
      for (const estado of ["vista", "resuelta", "nueva"]) {
        const r = await c.query(
          `update public.alerta set estado = $2 where visita_id = $1`,
          [visita, estado],
        );
        expect(r.rowCount).toBe(1);
      }
    });
  });

  it("una alerta anulada por el motor se puede REABRIR desde la app", async () => {
    // El valor nuevo es `nueva`, no `anulada`: el `with check` no lo impide.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantar(c, "f4", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      await pasoActualiza(c, cadena, { stock_sistema: 10, stock_piso: 10 });
      expect((await alertasDe(c, cadena.visita))[0]?.estado).toBe("anulada");

      const r = await c.query(
        `update public.alerta set estado = 'nueva' where visita_id = $1`,
        [cadena.visita],
      );
      expect(r.rowCount).toBe(1);
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

  it("clasifica TODOS los valores del enum, sin dejar ninguno sin decidir", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // La regla del proyecto: una función que se ramifica sobre un enum se
      // prueba con todos sus valores. Aquí además importa el fail-closed — el
      // tipo que alguien añada mañana tiene que nacer siendo de staff, y este
      // test se pondrá rojo para obligar a decidirlo a conciencia.
      const r = await c.query<{ tipo: string; del_cliente: boolean }>(
        `select t::text as tipo, app.tipo_alerta_del_cliente(t) as del_cliente
         from unnest(enum_range(null::public.tipo_alerta)) as t
         order by t::text`,
      );
      const porTipo = Object.fromEntries(
        r.rows.map((f) => [f.tipo, f.del_cliente]),
      );
      expect(porTipo).toEqual({
        quiebre: true,
        diferencia_stock: true,
        desviacion_precio: true,
        promo_no_activa: true,
        exhibicion_incompleta: true,
        contingencia: true,
        verificacion_fotos: false,
      });
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
