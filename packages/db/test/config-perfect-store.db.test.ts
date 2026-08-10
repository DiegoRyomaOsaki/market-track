import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  comoUsuario,
  conectar,
  contarFilas,
  TENANTS,
  USUARIOS,
} from "./ayudas";

// La configuración de Perfect Store: su resolución y su inmutabilidad.
//
// Las dos cosas son el contrato del que cuelga el motor de puntaje. Si la
// resolución elige mal, una marca se mide con los pesos de otra categoría; si la
// inmutabilidad falla, reajustar una ponderación reescribe puntajes ya cerrados —
// y esos puntajes pagan bonos.

const IDS = {
  marcaMrc: "cccccccc-0000-0000-0000-000000000001",
  otraMarcaMrc: "cccccccc-0000-0000-0000-000000000002",
  categoriaMrc: "a0000004-0000-0000-0000-000000000001",
  categoriaRival: "b0000004-0000-0000-0000-000000000002",
  defaultDeMarca: "a0000019-0000-0000-0000-000000000001",
  afinadaPorCategoria: "a0000019-0000-0000-0000-000000000002",
} as const;

let client: Client;

beforeAll(async () => {
  client = await conectar();
});

afterAll(async () => {
  await client.end();
});

async function codigoDeError(
  c: Client,
  sql: string,
  valores: unknown[],
): Promise<string | null> {
  try {
    await c.query(sql, valores);
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? "sin-codigo";
  }
}

/** Qué configuración resuelve para esta combinación. */
async function resolver(
  c: Client,
  opciones: {
    categoria?: string | null;
    tipo?: string | null;
    fecha?: string;
    marca?: string;
  } = {},
): Promise<{ id: string; peso_distribucion: string } | null> {
  const r = await c.query<{ id: string; peso_distribucion: string }>(
    `select id, peso_distribucion
     from app.config_perfect_store_aplicable($1, $2, $3, $4, $5)`,
    [
      TENANTS.maracumango,
      opciones.marca ?? IDS.marcaMrc,
      opciones.categoria ?? null,
      opciones.tipo ?? null,
      opciones.fecha ?? "2026-08-01",
    ],
  );
  // La función devuelve una fila con todo nulo cuando no encuentra nada.
  return r.rows[0]?.id === null ? null : (r.rows[0] ?? null);
}

const INSERTAR = `
  insert into public.config_perfect_store
    (tenant_id, marca_id, categoria_id, tipo_tienda,
     peso_distribucion, peso_visibilidad, peso_precio, peso_pop, peso_orden,
     sos_objetivo_pct, vigente_desde)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
`;

describe("la resolución de la configuración aplicable", () => {
  it("sin categoría ni tipo cae al DEFAULT DE MARCA", async () => {
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      expect((await resolver(c))?.id).toBe(IDS.defaultDeMarca);
    });
  });

  it("con una categoría configurada gana la MÁS ESPECÍFICA", async () => {
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      const r = await resolver(c, { categoria: IDS.categoriaMrc });
      expect(r?.id).toBe(IDS.afinadaPorCategoria);
      expect(Number(r?.peso_distribucion)).toBe(40);
    });
  });

  it("con una categoría SIN afinar vuelve al default de marca", async () => {
    // Una fila acotada a "Bebidas" no puede ganar para otra categoría.
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      await c.query(
        `insert into public.categoria (id, tenant_id, nombre, codigo_externo)
         values ('e0000004-0000-0000-0000-000000000099', $1, 'Snacks', 'SNK')`,
        [TENANTS.maracumango],
      );

      expect(
        (
          await resolver(c, {
            categoria: "e0000004-0000-0000-0000-000000000099",
          })
        )?.id,
      ).toBe(IDS.defaultDeMarca);
    });
  });

  it("categoría Y tipo de tienda gana a categoría sola", async () => {
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      const r = await c.query<{ id: string }>(`${INSERTAR} returning id`, [
        TENANTS.maracumango,
        IDS.marcaMrc,
        IDS.categoriaMrc,
        "hiper",
        50,
        20,
        20,
        5,
        5,
        60,
        "2026-01-01",
      ]);
      const masEspecifica = r.rows[0]?.id;

      expect(
        (await resolver(c, { categoria: IDS.categoriaMrc, tipo: "hiper" }))?.id,
      ).toBe(masEspecifica);
      // Y para otro tipo de tienda sigue ganando la de categoría sola.
      expect(
        (await resolver(c, { categoria: IDS.categoriaMrc, tipo: "super" }))?.id,
      ).toBe(IDS.afinadaPorCategoria);
    });
  });

  it("una configuración que aún NO está vigente no se elige", async () => {
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      await c.query(INSERTAR, [
        TENANTS.maracumango,
        IDS.marcaMrc,
        null,
        null,
        10,
        10,
        10,
        35,
        35,
        50,
        "2026-12-01",
      ]);

      // En agosto todavía manda la de enero.
      expect((await resolver(c, { fecha: "2026-08-01" }))?.id).toBe(
        IDS.defaultDeMarca,
      );
    });
  });

  it("a partir de su fecha, la nueva manda — y la vieja sigue mandando en el pasado", async () => {
    // Es lo que hace que recalcular un puntaje de julio dé lo mismo que dio en
    // julio, aunque en septiembre se hayan reajustado los pesos.
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      const r = await c.query<{ id: string }>(`${INSERTAR} returning id`, [
        TENANTS.maracumango,
        IDS.marcaMrc,
        null,
        null,
        10,
        10,
        10,
        35,
        35,
        50,
        "2026-09-01",
      ]);
      const nueva = r.rows[0]?.id;

      expect((await resolver(c, { fecha: "2026-09-15" }))?.id).toBe(nueva);
      expect((await resolver(c, { fecha: "2026-07-15" }))?.id).toBe(
        IDS.defaultDeMarca,
      );
    });
  });

  it("una marca sin configuración no resuelve nada", async () => {
    // No inventa un default: el motor tiene que poder distinguir "sin configurar"
    // de "configurada con ceros".
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      expect(await resolver(c, { marca: IDS.otraMarcaMrc })).toBeNull();
    });
  });
});

describe("la configuración es inmutable", () => {
  it("al admin ni siquiera se le concede el UPDATE: muere en el grant", async () => {
    // La puerta antes que el portero. `config_perfect_store` solo concede
    // `select, insert` a `authenticated`, así que la edición no llega ni a
    // evaluarse.
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      expect(
        await codigoDeError(
          c,
          "update public.config_perfect_store set peso_visibilidad = 40 where id = $1",
          [IDS.defaultDeMarca],
        ),
      ).toBe("42501");
    });
  });

  it("y para quien SÍ tiene el privilegio, el disparador lo rechaza igual", async () => {
    // La segunda red, la que cubre a `service_role` y a cualquier script con
    // permisos: sin ella, reajustar una ponderación le cambiaría los pesos bajo
    // los pies a todos los puntajes calculados con ella (ADR-0011).
    await client.query("begin");
    try {
      const codigo = await codigoDeError(
        client,
        "update public.config_perfect_store set peso_visibilidad = 40 where id = $1",
        [IDS.defaultDeMarca],
      );
      expect(codigo).toBe("23514");
    } finally {
      await client.query("rollback");
    }
  });

  it("insertar otra con una fecha nueva SÍ se puede: así se cambia", async () => {
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      expect(
        await codigoDeError(c, INSERTAR, [
          TENANTS.maracumango,
          IDS.marcaMrc,
          null,
          null,
          20,
          20,
          20,
          20,
          20,
          40,
          "2026-10-01",
        ]),
      ).toBeNull();
    });
  });

  it("dos configuraciones con la misma clave y fecha colisionan", async () => {
    // `nulls not distinct`: dos "para todas las categorías" del mismo día son la
    // misma fila, no dos candidatas compitiendo por el mismo nivel.
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      expect(
        await codigoDeError(c, INSERTAR, [
          TENANTS.maracumango,
          IDS.marcaMrc,
          null,
          null,
          20,
          20,
          20,
          20,
          20,
          40,
          "2026-01-01",
        ]),
      ).toBe("23505");
    });
  });
});

describe("lo que la base hace cumplir de los pesos", () => {
  it("unos pesos que NO suman 100 se rechazan", async () => {
    // Sin esto, un puntaje "sobre 100" dejaría de significar lo mismo entre dos
    // marcas y la comparación que el cliente compra se rompe en silencio.
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      expect(
        await codigoDeError(c, INSERTAR, [
          TENANTS.maracumango,
          IDS.marcaMrc,
          null,
          null,
          30,
          30,
          30,
          30,
          30,
          40,
          "2026-11-01",
        ]),
      ).toBe("23514");
    });
  });

  it("una escala cualitativa invertida se rechaza", async () => {
    // "Regular" valiendo más que "bien" daría un puntaje que premia lo contrario.
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      expect(
        await codigoDeError(
          c,
          `insert into public.config_perfect_store
             (tenant_id, marca_id, peso_distribucion, peso_visibilidad,
              peso_precio, peso_pop, peso_orden, sos_objetivo_pct,
              orden_bien_pts, orden_regular_pts, vigente_desde)
           values ($1, $2, 20, 20, 20, 20, 20, 40, 10, 90, '2026-11-02')`,
          [TENANTS.maracumango, IDS.marcaMrc],
        ),
      ).toBe("23514");
    });
  });

  it("un objetivo de share of shelf de cero se rechaza", async () => {
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      expect(
        await codigoDeError(c, INSERTAR, [
          TENANTS.maracumango,
          IDS.marcaMrc,
          null,
          null,
          20,
          20,
          20,
          20,
          20,
          0,
          "2026-11-03",
        ]),
      ).toBe("23514");
    });
  });

  it("la categoría de OTRO cliente no se puede ponderar", async () => {
    // La FK compuesta. Sin ella se podría configurar la marca de un cliente con
    // la categoría de otro y el puntaje agruparía cruzado.
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      expect(
        await codigoDeError(c, INSERTAR, [
          TENANTS.maracumango,
          IDS.marcaMrc,
          IDS.categoriaRival,
          null,
          20,
          20,
          20,
          20,
          20,
          40,
          "2026-11-04",
        ]),
      ).toBe("23503");
    });
  });
});

describe("quién ve y quién escribe la configuración", () => {
  it("el cliente-marca ve SOLO la suya: es la regla con la que se le mide", async () => {
    await comoUsuario(client, USUARIOS.clienteMaracumango, async (c) => {
      expect(await contarFilas(c, "config_perfect_store")).toBe(2);
    });
  });

  it("el staff las ve todas", async () => {
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      expect(await contarFilas(c, "config_perfect_store")).toBe(3);
    });
  });

  it("el cliente-marca NO la escribe: los pesos los pacta, no los teclea", async () => {
    await comoUsuario(client, USUARIOS.clienteMaracumango, async (c) => {
      expect(
        await codigoDeError(c, INSERTAR, [
          TENANTS.maracumango,
          IDS.marcaMrc,
          null,
          null,
          20,
          20,
          20,
          20,
          20,
          40,
          "2026-11-05",
        ]),
      ).toBe("42501");
    });
  });

  it("el supervisor tampoco", async () => {
    await comoUsuario(client, USUARIOS.supervisor, async (c) => {
      expect(
        await codigoDeError(c, INSERTAR, [
          TENANTS.maracumango,
          IDS.marcaMrc,
          null,
          null,
          20,
          20,
          20,
          20,
          20,
          40,
          "2026-11-06",
        ]),
      ).toBe("42501");
    });
  });

  it("nadie borra una configuración: el histórico depende de ella", async () => {
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      expect(
        await codigoDeError(
          c,
          "delete from public.config_perfect_store where id = $1",
          [IDS.defaultDeMarca],
        ),
      ).toBe("42501");
    });
  });
});
