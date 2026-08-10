import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// Las claves naturales de los hechos comerciales —precio regular, promoción y
// exhibición negociada— y quién puede escribirlos.
//
// `importacion.db.test.ts` cubre el camino del IMPORTADOR, que entra por
// `on conflict do update` y por tanto NUNCA ve un 23505. El panel entra por un
// INSERT pelado: es un camino distinto, y su comportamiento ante el duplicado
// —que es un criterio de aceptación— no lo prueba nadie más.

const IDS = {
  tiendaMrc: "a0000002-0000-0000-0000-000000000001",
  marcaMrc: "cccccccc-0000-0000-0000-000000000001",
  otraMarcaMrc: "cccccccc-0000-0000-0000-000000000002",
  skuMrc: "a0000003-0000-0000-0000-000000000001",
  cadenaMrc: "a0000001-0000-0000-0000-000000000001",
  tiendaRival: "b0000002-0000-0000-0000-000000000002",
  marcaRival: "dddddddd-0000-0000-0000-000000000001",
} as const;

/** El código de Postgres para «viola una restricción unique». */
const DUPLICADO = "23505";

let client: Client;

beforeAll(async () => {
  client = await conectar();
});

afterAll(async () => {
  await client.end();
});

/** Corre la consulta y devuelve el código de error de Postgres, o null si pasó. */
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

const INSERTAR_EXHIBICION = `
  insert into public.exhibicion_negociada
    (tenant_id, tienda_id, marca_id, tipo, fecha_inicio, fecha_fin)
  values ($1, $2, $3, $4, $5, $6)
`;

describe("clave natural de exhibicion_negociada", () => {
  it("el MISMO trato cargado dos veces se rechaza", async () => {
    // Sin esta clave, el motor de alertas disparaba `exhibicion_incompleta` por
    // duplicado sobre la misma cabecera.
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      const valores = [
        TENANTS.maracumango,
        IDS.tiendaMrc,
        IDS.marcaMrc,
        "ruma",
        "2026-09-01",
        "2026-09-30",
      ];
      expect(await codigoDeError(c, INSERTAR_EXHIBICION, valores)).toBeNull();
      expect(await codigoDeError(c, INSERTAR_EXHIBICION, valores)).toBe(
        DUPLICADO,
      );
    });
  });

  it("la MISMA cabecera renegociada para otro periodo SÍ entra", async () => {
    // Es la razón de que `fecha_inicio` esté en la clave: sin ella habría que
    // borrar el trato de julio para poder cargar el de agosto, y con él su
    // histórico.
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      const septiembre = [
        TENANTS.maracumango,
        IDS.tiendaMrc,
        IDS.marcaMrc,
        "ruma",
        "2026-09-01",
        "2026-09-30",
      ];
      const octubre = [...septiembre.slice(0, 4), "2026-10-01", "2026-10-31"];

      expect(
        await codigoDeError(c, INSERTAR_EXHIBICION, septiembre),
      ).toBeNull();
      expect(await codigoDeError(c, INSERTAR_EXHIBICION, octubre)).toBeNull();
    });
  });

  it("otro TIPO de espacio en la misma tienda y fecha SÍ entra", async () => {
    // Una marca puede tener a la vez una ruma y una isla: son tratos distintos.
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      const ruma = [
        TENANTS.maracumango,
        IDS.tiendaMrc,
        IDS.marcaMrc,
        "ruma",
        "2026-09-01",
        "2026-09-30",
      ];
      const isla = [...ruma.slice(0, 3), "isla", ...ruma.slice(4)];

      expect(await codigoDeError(c, INSERTAR_EXHIBICION, ruma)).toBeNull();
      expect(await codigoDeError(c, INSERTAR_EXHIBICION, isla)).toBeNull();
    });
  });

  it("otra MARCA en el mismo espacio y fecha SÍ entra", async () => {
    // El trato lo negocia la marca, no el cliente entero.
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      const deUna = [
        TENANTS.maracumango,
        IDS.tiendaMrc,
        IDS.marcaMrc,
        "ruma",
        "2026-09-01",
        "2026-09-30",
      ];
      const deLaOtra = [
        ...deUna.slice(0, 2),
        IDS.otraMarcaMrc,
        ...deUna.slice(3),
      ];

      expect(await codigoDeError(c, INSERTAR_EXHIBICION, deUna)).toBeNull();
      expect(await codigoDeError(c, INSERTAR_EXHIBICION, deLaOtra)).toBeNull();
    });
  });
});

describe("clave natural de precio_regular", () => {
  const INSERTAR = `
    insert into public.precio_regular
      (tenant_id, sku_id, cadena_id, tipo_tienda, precio, vigente_desde)
    values ($1, $2, $3, $4, $5, $6)
  `;

  it("dos precios SIN tipo de tienda colisionan: el NULL no escapa", async () => {
    // `nulls not distinct`. En SQL dos NULL son distintos por defecto, así que
    // sin esa cláusula cada alta crearía una fila nueva y el precio "vigente"
    // pasaría a ser ambiguo.
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      const valores = [
        TENANTS.maracumango,
        IDS.skuMrc,
        IDS.cadenaMrc,
        null,
        7.5,
        "2026-09-01",
      ];
      expect(await codigoDeError(c, INSERTAR, valores)).toBeNull();
      expect(await codigoDeError(c, INSERTAR, valores)).toBe(DUPLICADO);
    });
  });

  it("el mismo precio con otra fecha de vigencia SÍ entra", async () => {
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      const septiembre = [
        TENANTS.maracumango,
        IDS.skuMrc,
        IDS.cadenaMrc,
        null,
        7.5,
        "2026-09-01",
      ];
      const octubre = [...septiembre.slice(0, 5), "2026-10-01"];

      expect(await codigoDeError(c, INSERTAR, septiembre)).toBeNull();
      expect(await codigoDeError(c, INSERTAR, octubre)).toBeNull();
    });
  });
});

describe("clave natural de promocion", () => {
  const INSERTAR = `
    insert into public.promocion
      (tenant_id, sku_id, precio_promo, fecha_inicio, fecha_fin)
    values ($1, $2, $3, $4, $5)
  `;

  it("dos promos del mismo SKU que arrancan el mismo día se rechazan", async () => {
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      const valores = [
        TENANTS.maracumango,
        IDS.skuMrc,
        4.5,
        "2026-09-01",
        "2026-09-15",
      ];
      expect(await codigoDeError(c, INSERTAR, valores)).toBeNull();
      expect(await codigoDeError(c, INSERTAR, valores)).toBe(DUPLICADO);
    });
  });
});

describe("quién escribe los hechos comerciales", () => {
  it("el cliente-marca NO puede dar de alta una exhibición de su propio tenant", async () => {
    // Lee su tenant, pero el maestro no lo escribe él. La FK compuesta está
    // satisfecha a propósito: así lo único que puede rechazar la escritura es el
    // WITH CHECK de la política, no una referencia rota.
    await comoUsuario(client, USUARIOS.clienteMaracumango, async (c) => {
      expect(
        await codigoDeError(c, INSERTAR_EXHIBICION, [
          TENANTS.maracumango,
          IDS.tiendaMrc,
          IDS.marcaMrc,
          "ruma",
          "2026-09-01",
          "2026-09-30",
        ]),
      ).toBe("42501");
    });
  });

  it("el mercaderista tampoco", async () => {
    await comoUsuario(client, USUARIOS.mercaderistaMaracumango, async (c) => {
      expect(
        await codigoDeError(c, INSERTAR_EXHIBICION, [
          TENANTS.maracumango,
          IDS.tiendaMrc,
          IDS.marcaMrc,
          "ruma",
          "2026-09-01",
          "2026-09-30",
        ]),
      ).toBe("42501");
    });
  });

  it("el admin escribe en CUALQUIER cliente: es staff de la plataforma", async () => {
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      expect(
        await codigoDeError(c, INSERTAR_EXHIBICION, [
          TENANTS.rival,
          IDS.tiendaRival,
          IDS.marcaRival,
          "ruma",
          "2026-09-01",
          "2026-09-30",
        ]),
      ).toBeNull();
    });
  });
});
