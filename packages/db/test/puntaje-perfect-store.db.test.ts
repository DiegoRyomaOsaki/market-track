import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// El motor de puntaje de Perfect Store: las tres variables objetivas.
//
// Aquí es donde de verdad se prueba la métrica. El puntaje sale de la base y lo
// consumen el portal, el panel y el teléfono; si la cuenta está mal, los tres
// enseñan el mismo número equivocado y la discusión con la marca pasa a ser sobre
// cuál pantalla tiene razón.
//
// Todo corre dentro de la transacción con rollback de `comoUsuario`.

const IDS = {
  marca: "cccccccc-0000-0000-0000-000000000001",
  tienda: "a0000002-0000-0000-0000-000000000001",
  parada: "a0000009-0000-0000-0000-000000000001",
  sku: "a0000003-0000-0000-0000-000000000001",
  configDefault: "a0000019-0000-0000-0000-000000000001",
  marcaSinConfig: "cccccccc-0000-0000-0000-000000000002",
} as const;

/** El precio regular sembrado del SKU y la cadena de su tienda. La marca tolera
 *  un 5 %, así que el techo del "correcto" está en 7,245. */
const CADENA = "a0000001-0000-0000-0000-000000000001";
const PRECIO_REGULAR = 6.9;

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

/**
 * Cambia a quién se suplanta SIN abrir otra transacción.
 *
 * Hace falta porque un caso realista mezcla dos roles: el maestro (SKUs,
 * codificados, configuración) lo escribe el admin y los datos de campo los
 * escribe el mercaderista, y las políticas de escritura son distintas. Si el
 * test lo hiciera todo con un solo rol, o probaría algo que en producción no
 * pasa, o chocaría con la RLS — que es justo lo que pasó al escribirlo.
 */
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

type Puntaje = {
  distribucion_pct: string | null;
  visibilidad_pct: string | null;
  precio_pct: string | null;
  sos_real_pct: string | null;
  skus_codificados: number;
  skus_evaluados: number;
  skus_presentes: number;
  skus_precio_evaluados: number;
  skus_precio_correctos: number;
  config_id: string;
};

/**
 * Monta una visita con su levantamiento y sus SKUs, y lo cierra.
 *
 * Devuelve el puntaje que dejó el disparador, o null si no dejó ninguno — que es
 * un resultado tan válido como un número: significa "no se evaluó".
 */
async function levantarYPuntuar(
  c: Client,
  sufijo: string,
  opciones: {
    marcaId?: string;
    estado?: string;
    sosPropios?: number | null;
    sosCompetencia?: { marca: string; frentes: number }[];
    skus?: {
      skuId?: string;
      quiebre?: { sistema: number; piso: number };
      precio?: number | null;
      hayPromo?: boolean;
      promoComunicada?: boolean;
    }[];
  } = {},
): Promise<Puntaje | null> {
  const visita = `f0000010-0000-0000-0000-0000000000${sufijo}`;
  const lev = `f0000011-0000-0000-0000-0000000000${sufijo}`;

  await comoOtro(c, USUARIOS.mercaderistaMaracumango, async () => {
    await c.query(
      // El `tenant_id` va EXPLÍCITO: su default es `app.tenant_actual()`, que para
      // el admin es null —es staff de la plataforma, no pertenece a ningún cliente—
      // y la columna es not null.
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
        opciones.marcaId ?? IDS.marca,
        opciones.sosPropios ?? null,
        JSON.stringify(opciones.sosCompetencia ?? []),
      ],
    );

    let n = 0;
    for (const s of opciones.skus ?? []) {
      n += 1;
      await c.query(
        `insert into public.levantamiento_sku
         (tenant_id, levantamiento_id, sku_id, stock_sistema, stock_piso,
          precio_registrado, hay_promo, promo_comunicada)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          TENANTS.maracumango,
          lev,
          s.skuId ?? IDS.sku,
          s.quiebre?.sistema ?? null,
          s.quiebre?.piso ?? null,
          s.precio ?? null,
          s.hayPromo ?? null,
          s.promoComunicada ?? null,
        ],
      );
      if (n > 50) break;
    }

    await c.query(`update public.levantamiento set estado = $2 where id = $1`, [
      lev,
      opciones.estado ?? "completado",
    ]);
  });

  const r = await c.query<Puntaje>(
    `select distribucion_pct, visibilidad_pct, precio_pct, sos_real_pct,
            skus_codificados, skus_evaluados, skus_presentes,
            skus_precio_evaluados, skus_precio_correctos, config_id
     from public.puntaje_perfect_store where levantamiento_id = $1`,
    [lev],
  );
  return r.rows[0] ?? null;
}

/**
 * Crea N SKUs codificados en la tienda, además del que ya trae el seed.
 *
 * `conPrecio` siembra además su precio regular. Sin él, esos SKUs salen como
 * `sin_precio_vigente` y NO entran en el denominador del puntaje de precio —
 * correcto, pero inservible para probar una proporción.
 */
async function codificar(
  c: Client,
  cuantos: number,
  conPrecio = false,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < cuantos; i += 1) {
    const id = `f0000003-0000-0000-0000-0000000000${String(i).padStart(2, "0")}`;
    await c.query(
      `insert into public.sku (id, tenant_id, marca_id, codigo, nombre)
       values ($1, $2, $3, $4, $5)`,
      [id, TENANTS.maracumango, IDS.marca, `EXTRA-${i}`, `SKU extra ${i}`],
    );
    await c.query(
      `insert into public.tienda_sku (tenant_id, tienda_id, sku_id)
       values ($1, $2, $3)`,
      [TENANTS.maracumango, IDS.tienda, id],
    );
    if (conPrecio) {
      await c.query(
        `insert into public.precio_regular
           (tenant_id, sku_id, cadena_id, precio, vigente_desde)
         values ($1, $2, $3, $4, '2026-01-01')`,
        [TENANTS.maracumango, id, CADENA, PRECIO_REGULAR],
      );
    }
    ids.push(id);
  }
  return ids;
}

describe("distribución / disponibilidad", () => {
  it("un SKU presente sobre uno codificado da 100", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "01", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      expect(Number(p?.distribucion_pct)).toBe(100);
      expect(p?.skus_presentes).toBe(1);
      expect(p?.skus_evaluados).toBe(1);
    });
  });

  it("un SKU en QUIEBRE no cuenta como presente", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "02", {
        // stock_sistema > 0 y piso 0: eso es un quiebre (columna generada).
        skus: [{ quiebre: { sistema: 5, piso: 0 } }],
      });

      expect(Number(p?.distribucion_pct)).toBe(0);
      expect(p?.skus_presentes).toBe(0);
    });
  });

  it("un SKU codificado que NO se levantó no entra en el denominador", async () => {
    // "Sin dato" no es "ausente": meterlo hundiría el puntaje por una visita
    // incompleta en vez de por una tienda mal ejecutada.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await codificar(c, 3);
      const p = await levantarYPuntuar(c, "03", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      expect(p?.skus_codificados).toBe(4);
      expect(p?.skus_evaluados).toBe(1);
      expect(Number(p?.distribucion_pct)).toBe(100);
    });
  });

  it("sin SKUs codificados la distribución queda SIN EVALUAR, no en cero", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query(
        `update public.tienda_sku set activo = false where tienda_id = $1`,
        [IDS.tienda],
      );
      const p = await levantarYPuntuar(c, "04", {});

      expect(p?.distribucion_pct).toBeNull();
      expect(p?.skus_codificados).toBe(0);
    });
  });
});

describe("visibilidad (share of shelf)", () => {
  it("el real se compara contra el objetivo de la configuración", async () => {
    // El seed configura el objetivo en 35. Con 35 propios y 65 de competencia el
    // real es 35 %, que sobre un objetivo de 35 da exactamente 100.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "05", {
        sosPropios: 35,
        sosCompetencia: [{ marca: "Rival", frentes: 65 }],
      });

      expect(Number(p?.sos_real_pct)).toBe(35);
      expect(Number(p?.visibilidad_pct)).toBe(100);
    });
  });

  it("por debajo del objetivo, el puntaje es proporcional", async () => {
    // 17.5 % real sobre un objetivo de 35 → la mitad.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // `sos_frentes_propios` es un entero: 35 de 200 son el 17,5 %.
      const p = await levantarYPuntuar(c, "06", {
        sosPropios: 35,
        sosCompetencia: [{ marca: "Rival", frentes: 165 }],
      });

      expect(Number(p?.visibilidad_pct)).toBe(50);
    });
  });

  it("superar el objetivo TOPA en 100: no compensa otra variable", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "07", {
        sosPropios: 90,
        sosCompetencia: [{ marca: "Rival", frentes: 10 }],
      });

      expect(Number(p?.sos_real_pct)).toBe(90);
      expect(Number(p?.visibilidad_pct)).toBe(100);
    });
  });

  it("sin medición de SOS queda SIN EVALUAR", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "08", { sosPropios: null });

      expect(p?.visibilidad_pct).toBeNull();
      expect(p?.sos_real_pct).toBeNull();
    });
  });

  it("una góndola vacía —cero propios y cero competencia— no divide por cero", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "09", {
        sosPropios: 0,
        sosCompetencia: [],
      });

      expect(p?.visibilidad_pct).toBeNull();
    });
  });
});

describe("precio y promoción", () => {
  it("el ejemplo del cliente: 40 correctos de 50 dan 80", async () => {
    // "Si tienes 40 bien y 10 mal, tienes 80 sobre 100" (reunión, 3 ago 2026).
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const extra = await codificar(c, 49, true);
      const todos = [IDS.sku, ...extra];
      const skus = todos.map((skuId, i) => ({
        skuId,
        // Los diez últimos, muy por encima del regular: sobreprecio.
        precio: i < 40 ? PRECIO_REGULAR : PRECIO_REGULAR * 2,
      }));

      const p = await levantarYPuntuar(c, "10", { skus });

      expect(p?.skus_precio_evaluados).toBe(50);
      expect(p?.skus_precio_correctos).toBe(40);
      expect(Number(p?.precio_pct)).toBe(80);
    });
  });

  it("dentro de la tolerancia cuenta como correcto", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "11", {
        // 7,24 queda justo dentro del 5 % (el límite es 7,245); 7,25 lo pasaría,
        // y la columna es numeric(10,2), así que no hay margen para el redondeo.
        skus: [{ precio: 7.24 }],
      });

      expect(Number(p?.precio_pct)).toBe(100);
    });
  });

  it("un SKU SIN precio digitado no entra en el denominador", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "12", {
        skus: [{ precio: null, quiebre: { sistema: 5, piso: 5 } }],
      });

      expect(p?.skus_precio_evaluados).toBe(0);
      expect(p?.precio_pct).toBeNull();
    });
  });

  it("un SKU sin precio vigente en el maestro tampoco: falta el dato, no falla la tienda", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const [otro] = await codificar(c, 1);
      const p = await levantarYPuntuar(c, "13", {
        skus: [{ skuId: otro, precio: 9.99 }],
      });

      expect(p?.skus_precio_evaluados).toBe(0);
      expect(p?.precio_pct).toBeNull();
    });
  });

  it("por debajo del regular con una promo comunicada es correcto", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query(
        `insert into public.promocion
           (tenant_id, sku_id, precio_promo, fecha_inicio, fecha_fin, comunicada)
         values ($1, $2, 4.50, app.hoy_lima() - 1, app.hoy_lima() + 1, true)`,
        [TENANTS.maracumango, IDS.sku],
      );

      const p = await levantarYPuntuar(c, "14", { skus: [{ precio: 4.5 }] });

      expect(Number(p?.precio_pct)).toBe(100);
    });
  });

  it("por debajo del regular sin promo NO es correcto", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "15", { skus: [{ precio: 4.5 }] });

      expect(Number(p?.precio_pct)).toBe(0);
      expect(p?.skus_precio_evaluados).toBe(1);
    });
  });
});

describe("cuándo NO se deja puntaje", () => {
  it("un levantamiento OMITIDO por contingencia no puntúa cero: no deja fila", async () => {
    // Es el criterio de aceptación. Un cero convertiría en "mal ejecutada" una
    // tienda donde el mercaderista no pudo hacer el paso.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "16", {
        estado: "omitido",
        skus: [{ quiebre: { sistema: 5, piso: 0 } }],
      });

      expect(p).toBeNull();
    });
  });

  it("una marca SIN configuración no puntúa: no se inventa un default", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // No se borra la configuración —nadie puede, y es deliberado—: se usa la
      // segunda marca del cliente, que no tiene ninguna.
      const p = await levantarYPuntuar(c, "17", {
        marcaId: IDS.marcaSinConfig,
      });

      expect(p).toBeNull();
    });
  });

  it("volver a `en_curso` retira el puntaje que había", async () => {
    // Reabrir un levantamiento invalida su número: dejarlo sería enseñar el
    // puntaje de una foto que ya no es la actual.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "18", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });
      expect(p).not.toBeNull();

      // Como MERCADERISTA: un update que la RLS bloquea afecta a 0 filas sin dar
      // error, el disparador no llega a correr y el test pasaría creyendo que el
      // puntaje se conservó a propósito.
      await comoOtro(c, USUARIOS.mercaderistaMaracumango, () =>
        c.query(
          `update public.levantamiento set estado = 'en_curso'
           where id = 'f0000011-0000-0000-0000-000000000018'`,
        ),
      );

      const r = await c.query(
        `select 1 from public.puntaje_perfect_store
         where levantamiento_id = 'f0000011-0000-0000-0000-000000000018'`,
      );
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("un levantamiento que NACE completado también puntúa", () => {
  it("puntúa al insertarlo, no solo al actualizarlo", async () => {
    // El camino normal es crear `en_curso` y luego completar —y el conector de
    // PowerSync reaplica las operaciones en ese orden—, pero nada obliga a que
    // sea el único. Un puntaje que falta porque el levantamiento llegó por otra
    // puerta no se nota.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const visita = "f0000010-0000-0000-0000-000000000030";
      const lev = "f0000011-0000-0000-0000-000000000030";

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
          `insert into public.levantamiento (id, tenant_id, visita_id, marca_id, estado)
           values ($1, $2, $3, $4, 'completado')`,
          [lev, TENANTS.maracumango, visita, IDS.marca],
        );
      });

      const r = await c.query(
        `select 1 from public.puntaje_perfect_store where levantamiento_id = $1`,
        [lev],
      );
      expect(r.rowCount).toBe(1);
    });
  });
});

describe("un SKU que llega tarde corrige el puntaje", () => {
  it("recalcula si el levantamiento ya estaba cerrado", async () => {
    // El orden normal lo garantiza el conector de PowerSync. Pero una operación
    // rechazada y reintentada más tarde dejaría el puntaje sobre un subconjunto,
    // y sin recálculo no se corregiría nunca — un número corto en silencio es
    // peor que uno que falta.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "31", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });
      expect(Number(p?.distribucion_pct)).toBe(100);
      expect(p?.skus_evaluados).toBe(1);

      // Un segundo SKU codificado, en quiebre, que llega DESPUÉS del cierre.
      const [tarde] = await codificar(c, 1);
      await comoOtro(c, USUARIOS.mercaderistaMaracumango, () =>
        c.query(
          `insert into public.levantamiento_sku
             (tenant_id, levantamiento_id, sku_id, stock_sistema, stock_piso)
           values ($1, 'f0000011-0000-0000-0000-000000000031', $2, 5, 0)`,
          [TENANTS.maracumango, tarde],
        ),
      );

      const r = await c.query<{
        distribucion_pct: string;
        skus_evaluados: number;
      }>(
        `select distribucion_pct, skus_evaluados from public.puntaje_perfect_store
         where levantamiento_id = 'f0000011-0000-0000-0000-000000000031'`,
      );
      expect(r.rows[0]?.skus_evaluados).toBe(2);
      expect(Number(r.rows[0]?.distribucion_pct)).toBe(50);
    });
  });
});

describe("el puntaje guarda con qué se calculó", () => {
  it("referencia la configuración vigente", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "19", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      expect(p?.config_id).toBe(IDS.configDefault);
    });
  });

  it("la configuración referenciada no se puede borrar", async () => {
    // `on delete restrict`: sin él, borrar una configuración dejaría puntajes
    // que ya nadie puede explicar.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await levantarYPuntuar(c, "20", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      let codigo = "";
      try {
        await c.query(`delete from public.config_perfect_store where id = $1`, [
          IDS.configDefault,
        ]);
      } catch (err) {
        codigo = (err as { code?: string }).code ?? "";
      }
      expect(codigo).not.toBe("");
    });
  });
});

describe("quién ve el puntaje", () => {
  it("el cliente-marca ve el suyo", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await levantarYPuntuar(c, "21", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });
    });

    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      const r = await c.query(
        `select 1 from public.puntaje_perfect_store where tenant_id = $1`,
        [TENANTS.rival],
      );
      expect(r.rowCount).toBe(0);
    });
  });

  it("nadie lo ESCRIBE desde una app: lo produce el servidor", async () => {
    // Sin esto, una app podría maquillar su propio número.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      let codigo = "";
      try {
        await c.query(
          `insert into public.puntaje_perfect_store
             (levantamiento_id, tenant_id, config_id, distribucion_pct)
           values ('a0000011-0000-0000-0000-000000000001', $1, $2, 100)`,
          [TENANTS.maracumango, IDS.configDefault],
        );
      } catch (err) {
        codigo = (err as { code?: string }).code ?? "";
      }
      expect(codigo).toBe("42501");
    });
  });
});
