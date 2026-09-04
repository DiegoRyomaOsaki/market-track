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

/** «Viola una restricción de exclusión» — dos periodos de precio que se pisan. */
const SOLAPE = "23P01";

/** «Viola un CHECK» — lo levantan los triggers que protegen el histórico. */
const REGLA = "23514";

let client: Client;

beforeAll(async () => {
  client = await conectar();
});

afterAll(async () => {
  await client.end();
});

/**
 * Cierra el periodo que el seed deja abierto para el SKU y la cadena de prueba.
 *
 * Sin esto, cualquier periodo nuevo del mismo bucket lo pisa y la restricción de
 * solapamiento lo rechaza — que es el comportamiento correcto.
 *
 * Se cierra SIEMPRE en una fecha futura, y los periodos de prueba arrancan
 * después: cortar un periodo abierto hacia el pasado deja ese tramo sin precio
 * vigente y el trigger lo rechaza, con razón. Por eso estos casos viven en 2027
 * y no en el mes que viene.
 */
async function cerrarElDelSeed(c: Client, hasta: string): Promise<void> {
  await c.query(
    `update public.precio_regular set vigente_hasta = $1
      where tenant_id = $2 and sku_id = $3 and cadena_id = $4
        and tipo_tienda is null`,
    [hasta, TENANTS.maracumango, IDS.skuMrc, IDS.cadenaMrc],
  );
}

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
    // `nulls not distinct` en la clave natural, Y una restricción de exclusión
    // PARCIAL para el bucket de tipo nulo. Hacen falta las dos: una exclusión
    // con `tipo_tienda with =` NO atrapa el solapamiento cuando el tipo es nulo
    // —medido— y es justo el bucket que llena el importador.
    //
    // Con la clave IDÉNTICA quien rechaza es el unique, que se comprueba antes
    // que la exclusión; el bucket nulo lo cubren los dos.
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      await cerrarElDelSeed(c, "2027-06-30");
      const valores = [
        TENANTS.maracumango,
        IDS.skuMrc,
        IDS.cadenaMrc,
        null,
        7.5,
        "2027-07-01",
      ];
      expect(await codigoDeError(c, INSERTAR, valores)).toBeNull();
      expect(await codigoDeError(c, INSERTAR, valores)).toBe(DUPLICADO);
    });
  });

  it("un periodo con OTRA fecha ya no entra por un INSERT pelado: pisaría al abierto", async () => {
    // Cambio de contrato deliberado. Antes esto entraba y dejaba dos periodos
    // abiertos a la vez, y el resolvedor desempataba por `vigente_desde desc`.
    // Ahora el periodo anterior sigue vigente hasta que alguien lo cierre, así
    // que el nuevo lo pisa: abrir un periodo es cerrar el anterior Y abrir el
    // nuevo, y eso tiene un solo dueño (`abrir_periodo_precio`).
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      const septiembre = [
        TENANTS.maracumango,
        IDS.skuMrc,
        IDS.cadenaMrc,
        null,
        7.5,
        "2027-07-01",
      ];
      const octubre = [...septiembre.slice(0, 5), "2027-08-01"];

      await cerrarElDelSeed(c, "2027-06-30");
      expect(await codigoDeError(c, INSERTAR, septiembre)).toBeNull();
      expect(await codigoDeError(c, INSERTAR, octubre)).toBe(SOLAPE);
    });
  });

  it("un precio de un tipo de tienda CONVIVE con el general de la cadena", async () => {
    // El control positivo de la restricción: estos dos se solapan A PROPÓSITO
    // —el resolvedor desempata entre ellos— y prohibirlo rompería el modelo.
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      const general = [
        TENANTS.maracumango,
        IDS.skuMrc,
        IDS.cadenaMrc,
        null,
        7.5,
        "2027-07-01",
      ];
      const hiper = [...general.slice(0, 3), "hiper", 8.5, "2027-07-01"];

      await cerrarElDelSeed(c, "2027-06-30");
      expect(await codigoDeError(c, INSERTAR, general)).toBeNull();
      expect(await codigoDeError(c, INSERTAR, hiper)).toBeNull();
    });
  });

  it("un cierre anterior al propio inicio se rechaza", async () => {
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      const codigo = await codigoDeError(
        c,
        `insert into public.precio_regular
           (tenant_id, sku_id, cadena_id, tipo_tienda, precio, vigente_desde,
            vigente_hasta)
         values ($1, $2, $3, null, $4, $5, $6)`,
        [
          TENANTS.maracumango,
          IDS.skuMrc,
          IDS.cadenaMrc,
          7.5,
          "2027-07-01",
          "2027-06-30",
        ],
      );
      expect(codigo).toBe(REGLA);
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

  it("el SUPERVISOR tampoco: las políticas exigen admin, no staff", async () => {
    // Es staff y lee el maestro entero, así que es el rol al que más fácil se le
    // escaparía la escritura si alguien relajara la política a `es_staff()`.
    await comoUsuario(client, USUARIOS.supervisor, async (c) => {
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
