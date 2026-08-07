import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// La aplicación del maestro comercial: todo o nada sobre siete tablas.
//
// Casi todo lo que se prueba aquí son los tres criterios que es fácil romper sin
// darse cuenta: que un fallo no deje nada a medias, que reimportar no duplique, y
// que una fila que desaparece del Excel NO se desactive.

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

/** Crea una importación previsualizada, como haría la validación previa. */
async function nuevaImportacion(
  c: Client,
  opciones: { tenant?: string; estado?: string } = {},
): Promise<string> {
  await c.query("set local role postgres");
  const r = await c.query<{ id: string }>(
    `insert into public.importacion (tenant_id, subido_por, estado)
     values ($1, $2, $3::public.estado_importacion) returning id`,
    [
      opciones.tenant ?? TENANTS.maracumango,
      USUARIOS.admin,
      opciones.estado ?? "previsualizada",
    ],
  );
  await c.query("set local role authenticated");
  return r.rows[0]!.id;
}

async function aplicar(
  c: Client,
  importacionId: string,
  lote: Record<string, unknown[]>,
): Promise<Record<string, number>> {
  const r = await c.query<{ resumen: Record<string, number> }>(
    `select public.aplicar_importacion($1, $2::jsonb) as resumen`,
    [importacionId, JSON.stringify(lote)],
  );
  return r.rows[0]!.resumen;
}

/** Corre algo que DEBE fallar, aislado en un savepoint. */
async function alIntentar(
  c: Client,
  fn: () => Promise<unknown>,
): Promise<string | null> {
  await c.query("savepoint intento");
  try {
    await fn();
    await c.query("release savepoint intento");
    return null;
  } catch (e) {
    await c.query("rollback to savepoint intento");
    return e instanceof Error ? e.message : String(e);
  }
}

async function contar(
  c: Client,
  tabla: string,
  codigo: string,
): Promise<number> {
  const r = await c.query<{ n: string }>(
    `select count(*)::text as n from public.${tabla} where codigo_externo = $1`,
    [codigo],
  );
  return Number(r.rows[0]?.n ?? "0");
}

const MARCA = {
  codigo_externo: "IMP-MRC",
  nombre: "Marca importada",
  tolerancia_precio_pct: 5,
};
const CADENA = {
  codigo_externo: "IMP-CAD",
  nombre: "Cadena importada",
  tipo_tienda: "super",
};
const SKU = {
  codigo_externo: "IMP-SKU",
  marca_codigo_externo: "IMP-MRC",
  codigo: "IMP-001",
  nombre: "Producto importado",
  presentacion: "1L",
  codigo_barras: null,
};
const TIENDA = {
  codigo_externo: "IMP-TDA",
  cadena_codigo_externo: "IMP-CAD",
  nombre: "Tienda importada",
  direccion: "Av. Siempre Viva 742",
  lat: -12.1,
  lon: -77.0,
  radio_geocerca_m: 150,
  cluster: null,
};

const LOTE_COMPLETO = {
  marca: [MARCA],
  cadena: [CADENA],
  sku: [SKU],
  tienda: [TIENDA],
  tienda_sku: [
    { tienda_codigo_externo: "IMP-TDA", sku_codigo_externo: "IMP-SKU" },
  ],
  precio_regular: [
    {
      sku_codigo_externo: "IMP-SKU",
      cadena_codigo_externo: "IMP-CAD",
      tipo_tienda: null,
      precio: 9.9,
      vigente_desde: "2026-08-01",
    },
  ],
  promocion: [
    {
      sku_codigo_externo: "IMP-SKU",
      precio_promo: 7.5,
      fecha_inicio: "2026-08-10",
      fecha_fin: "2026-08-20",
      comunicada: true,
    },
  ],
};

describe("aplicar_importacion — el camino feliz", () => {
  it("crea las siete entidades en el tenant de la fila `importacion`", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const id = await nuevaImportacion(c);
      const resumen = await aplicar(c, id, LOTE_COMPLETO);

      expect(resumen).toMatchObject({
        marca: 1,
        cadena: 1,
        sku: 1,
        tienda: 1,
        tienda_sku: 1,
        precio_regular: 1,
        promocion: 1,
      });

      const r = await c.query<{ tenant_id: string }>(
        `select tenant_id from public.sku where codigo_externo = 'IMP-SKU'`,
      );
      expect(r.rows[0]?.tenant_id).toBe(TENANTS.maracumango);
    });
  });

  it("marca la importación como aplicada, con su hora y su resumen", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const id = await nuevaImportacion(c);
      await aplicar(c, id, LOTE_COMPLETO);

      const r = await c.query<{ estado: string; aplicada_at: string | null }>(
        `select estado, aplicada_at from public.importacion where id = $1`,
        [id],
      );
      expect(r.rows[0]?.estado).toBe("aplicada");
      expect(r.rows[0]?.aplicada_at).not.toBeNull();
    });
  });

  it("guarda la geocerca a partir de lat/lon", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const id = await nuevaImportacion(c);
      await aplicar(c, id, LOTE_COMPLETO);

      const r = await c.query<{ lat: string; lon: string }>(
        `select lat::text, lon::text from public.tienda where codigo_externo = 'IMP-TDA'`,
      );
      expect(Number(r.rows[0]?.lat)).toBeCloseTo(-12.1, 4);
      expect(Number(r.rows[0]?.lon)).toBeCloseTo(-77.0, 4);
    });
  });
});

describe("aplicar_importacion — reimportar no duplica", () => {
  it("el mismo lote dos veces deja UNA fila y actualiza el nombre", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await aplicar(c, await nuevaImportacion(c), LOTE_COMPLETO);
      await aplicar(c, await nuevaImportacion(c), {
        ...LOTE_COMPLETO,
        marca: [{ ...MARCA, nombre: "Marca renombrada" }],
      });

      expect(await contar(c, "marca", "IMP-MRC")).toBe(1);
      expect(await contar(c, "sku", "IMP-SKU")).toBe(1);

      const r = await c.query<{ nombre: string }>(
        `select nombre from public.marca where codigo_externo = 'IMP-MRC'`,
      );
      expect(r.rows[0]?.nombre).toBe("Marca renombrada");
    });
  });

  it("un precio con `tipo_tienda` NULO actualiza el existente, no crea otro", async () => {
    // La clave lleva `nulls not distinct`: sin eso, dos nulos serían distintos y
    // cada import añadiría una fila de precio nueva para el mismo SKU.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await aplicar(c, await nuevaImportacion(c), LOTE_COMPLETO);
      await aplicar(c, await nuevaImportacion(c), {
        ...LOTE_COMPLETO,
        precio_regular: [{ ...LOTE_COMPLETO.precio_regular[0], precio: 11.5 }],
      });

      const r = await c.query<{ n: string; precio: string }>(
        `select count(*)::text as n, max(precio)::text as precio
         from public.precio_regular pr
         join public.sku s on s.id = pr.sku_id
         where s.codigo_externo = 'IMP-SKU'`,
      );
      expect(Number(r.rows[0]?.n)).toBe(1);
      expect(Number(r.rows[0]?.precio)).toBe(11.5);
    });
  });

  it("el vínculo tienda-sku no se duplica", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await aplicar(c, await nuevaImportacion(c), LOTE_COMPLETO);
      await aplicar(c, await nuevaImportacion(c), LOTE_COMPLETO);

      const r = await c.query<{ n: string }>(
        `select count(*)::text as n from public.tienda_sku ts
         join public.sku s on s.id = ts.sku_id
         where s.codigo_externo = 'IMP-SKU'`,
      );
      expect(Number(r.rows[0]?.n)).toBe(1);
    });
  });
});

describe("aplicar_importacion — nunca desactiva por ausencia", () => {
  it("una fila que YA NO está en el Excel sigue existiendo y activa", async () => {
    // Es el criterio de aceptación más fácil de romper sin querer: bastaría con
    // una barrida por diferencia "para limpiar lo que ya no manda el cliente".
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await aplicar(c, await nuevaImportacion(c), LOTE_COMPLETO);

      // El segundo import trae otra marca y NO la primera.
      await aplicar(c, await nuevaImportacion(c), {
        marca: [
          {
            codigo_externo: "IMP-OTRA",
            nombre: "Otra",
            tolerancia_precio_pct: 0,
          },
        ],
        cadena: [],
        sku: [],
        tienda: [],
        tienda_sku: [],
        precio_regular: [],
        promocion: [],
      });

      const r = await c.query<{ activo: boolean }>(
        `select activo from public.marca where codigo_externo = 'IMP-MRC'`,
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.activo).toBe(true);
    });
  });

  it("una fila que el admin desactivó a mano NO se reactiva por seguir en el Excel", async () => {
    // `activo` tiene un solo dueño: el panel. Si el importador también lo tocara,
    // desactivar una tienda duraría hasta el siguiente import.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await aplicar(c, await nuevaImportacion(c), LOTE_COMPLETO);
      await c.query(
        `update public.marca set activo = false where codigo_externo = 'IMP-MRC'`,
      );

      await aplicar(c, await nuevaImportacion(c), LOTE_COMPLETO);

      const r = await c.query<{ activo: boolean }>(
        `select activo from public.marca where codigo_externo = 'IMP-MRC'`,
      );
      expect(r.rows[0]?.activo).toBe(false);
    });
  });

  it("una tienda sin coordenadas en el Excel conserva la geocerca que tenía", async () => {
    // Borrarla dejaría a los mercaderistas de esa tienda sin poder fichar.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await aplicar(c, await nuevaImportacion(c), LOTE_COMPLETO);
      await aplicar(c, await nuevaImportacion(c), {
        ...LOTE_COMPLETO,
        tienda: [{ ...TIENDA, lat: null, lon: null }],
      });

      const r = await c.query<{ lat: string | null }>(
        `select lat::text from public.tienda where codigo_externo = 'IMP-TDA'`,
      );
      expect(Number(r.rows[0]?.lat)).toBeCloseTo(-12.1, 4);
    });
  });
  it("una celda VACÍA no borra lo que ya estaba: tolerancia y geocerca", async () => {
    // El caso real: el cliente manda el maestro completo una vez y luego uno
    // recortado sin esas columnas. Sin esto, la tolerancia volvía a 0 y el radio
    // de geocerca al default — y los mercaderistas de esa tienda dejaban de poder
    // fichar sin que nadie hubiera pedido ese cambio.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await aplicar(c, await nuevaImportacion(c), {
        ...LOTE_COMPLETO,
        marca: [{ ...MARCA, tolerancia_precio_pct: 7 }],
        tienda: [{ ...TIENDA, radio_geocerca_m: 250 }],
      });

      await aplicar(c, await nuevaImportacion(c), {
        ...LOTE_COMPLETO,
        marca: [{ ...MARCA, tolerancia_precio_pct: null }],
        tienda: [{ ...TIENDA, radio_geocerca_m: null }],
      });

      const r = await c.query<{ tol: string; radio: number }>(
        `select (select tolerancia_precio_pct::text from public.marca
                 where codigo_externo = 'IMP-MRC') as tol,
                (select radio_geocerca_m from public.tienda
                 where codigo_externo = 'IMP-TDA') as radio`,
      );
      expect(Number(r.rows[0]?.tol)).toBe(7);
      expect(r.rows[0]?.radio).toBe(250);
    });
  });

  it("una casilla de «comunicada» en blanco no apaga una promoción que sí lo estaba", async () => {
    // «No lo marcó» no es «dijo que no».
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await aplicar(c, await nuevaImportacion(c), LOTE_COMPLETO);
      await aplicar(c, await nuevaImportacion(c), {
        ...LOTE_COMPLETO,
        promocion: [{ ...LOTE_COMPLETO.promocion[0], comunicada: null }],
      });

      const r = await c.query<{ comunicada: boolean }>(
        `select p.comunicada from public.promocion p
         join public.sku s on s.id = p.sku_id
         where s.codigo_externo = 'IMP-SKU'`,
      );
      expect(r.rows[0]?.comunicada).toBe(true);
    });
  });
});

describe("aplicar_importacion — los contadores de las siete hojas", () => {
  // Cada `join` puede descartar filas en silencio. Los de `sku` y `tienda` ya
  // tienen su caso arriba; estos cierran las tres que faltaban.

  it("un vínculo tienda-sku que no resuelve aborta el lote", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const id = await nuevaImportacion(c);
      const error = await alIntentar(c, () =>
        aplicar(c, id, {
          ...LOTE_COMPLETO,
          tienda_sku: [
            {
              tienda_codigo_externo: "IMP-TDA",
              sku_codigo_externo: "NO-EXISTE",
            },
          ],
        }),
      );

      expect(error).toMatch(/^tienda_sku: llegaron 1 filas/m);
      expect(await contar(c, "marca", "IMP-MRC")).toBe(0);
    });
  });

  it("un precio cuya cadena no resuelve aborta el lote", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const id = await nuevaImportacion(c);
      const error = await alIntentar(c, () =>
        aplicar(c, id, {
          ...LOTE_COMPLETO,
          precio_regular: [
            {
              ...LOTE_COMPLETO.precio_regular[0],
              cadena_codigo_externo: "NO-EXISTE",
            },
          ],
        }),
      );

      expect(error).toMatch(/^precio_regular: llegaron 1 filas/m);
      expect(await contar(c, "sku", "IMP-SKU")).toBe(0);
    });
  });

  it("una promoción cuyo sku no resuelve aborta el lote", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const id = await nuevaImportacion(c);
      const error = await alIntentar(c, () =>
        aplicar(c, id, {
          ...LOTE_COMPLETO,
          promocion: [
            { ...LOTE_COMPLETO.promocion[0], sku_codigo_externo: "NO-EXISTE" },
          ],
        }),
      );

      expect(error).toMatch(/^promocion: llegaron 1 filas/m);
      expect(await contar(c, "marca", "IMP-MRC")).toBe(0);
    });
  });
});

describe("aplicar_importacion — todo o nada", () => {
  it("un SKU con una marca sin resolver aborta TODO el lote", async () => {
    // El `join` del upsert descartaría esa fila EN SILENCIO y el import diría
    // «aplicado» con SKUs faltando. El contador lo convierte en un abort.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const id = await nuevaImportacion(c);

      const error = await alIntentar(c, () =>
        aplicar(c, id, {
          ...LOTE_COMPLETO,
          sku: [{ ...SKU, marca_codigo_externo: "NO-EXISTE" }],
        }),
      );

      // El ancla no es cosmética: «tienda_sku: llegaron…» CONTIENE la
      // subcadena «sku: llegaron…», así que sin ella este test pasaba aunque
      // el contador que abortara fuera el de otra tabla. Comprobado quitando
      // el de `sku`: la suite seguía verde.
      expect(error).toMatch(/^sku: llegaron 1 filas y se escribieron 0/m);
      // Y lo que importa: la CADENA del mismo lote tampoco quedó escrita.
      expect(await contar(c, "cadena", "IMP-CAD")).toBe(0);
      expect(await contar(c, "marca", "IMP-MRC")).toBe(0);
    });
  });

  it("una tienda con una cadena sin resolver aborta y no deja marcas sueltas", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const id = await nuevaImportacion(c);

      const error = await alIntentar(c, () =>
        aplicar(c, id, {
          ...LOTE_COMPLETO,
          tienda: [{ ...TIENDA, cadena_codigo_externo: "NO-EXISTE" }],
        }),
      );

      expect(error).toMatch(/^tienda: llegaron 1 filas/m);
      expect(await contar(c, "sku", "IMP-SKU")).toBe(0);
    });
  });

  it("tras un abort la importación NO queda marcada como aplicada", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const id = await nuevaImportacion(c);
      await alIntentar(c, () =>
        aplicar(c, id, {
          ...LOTE_COMPLETO,
          sku: [{ ...SKU, marca_codigo_externo: "NO" }],
        }),
      );

      const r = await c.query<{ estado: string }>(
        `select estado from public.importacion where id = $1`,
        [id],
      );
      expect(r.rows[0]?.estado).toBe("previsualizada");
    });
  });
});

describe("aplicar_importacion — quién puede y sobre qué", () => {
  it("el supervisor no puede aplicar, y no deja nada escrito", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const id = await nuevaImportacion(c);
      const error = await alIntentar(c, () => aplicar(c, id, LOTE_COMPLETO));

      expect(error).toMatch(/solo un administrador/i);
      await c.query("set local role postgres");
      expect(await contar(c, "marca", "IMP-MRC")).toBe(0);
    });
  });

  it("un cliente con un id de importación AJENO no llega ni a leer la fila", async () => {
    // La RLS le esconde la fila, así que el `select into strict` falla. No hay
    // manera de averiguar si esa importación existe.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      const id = await nuevaImportacion(c);
      const error = await alIntentar(c, () => aplicar(c, id, LOTE_COMPLETO));
      expect(error).not.toBeNull();
    });
  });

  it("una importación YA APLICADA no se puede volver a aplicar", async () => {
    // Sin esta guarda, un doble clic o un reintento la aplicaría dos veces.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const id = await nuevaImportacion(c);
      await aplicar(c, id, LOTE_COMPLETO);

      const error = await alIntentar(c, () => aplicar(c, id, LOTE_COMPLETO));
      expect(error).toMatch(/solo se aplica una previsualizada/);
    });
  });

  it("una importación con errores tampoco: hay que corregir el Excel", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const id = await nuevaImportacion(c, { estado: "con_errores" });
      const error = await alIntentar(c, () => aplicar(c, id, LOTE_COMPLETO));
      expect(error).toMatch(/solo se aplica una previsualizada/);
    });
  });

  it("no se aplica el maestro de un cliente dado de baja", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const id = await nuevaImportacion(c);
      await c.query("set local role postgres");
      await c.query(`update public.tenant set activo = false where id = $1`, [
        TENANTS.maracumango,
      ]);
      await c.query("set local role authenticated");

      const error = await alIntentar(c, () => aplicar(c, id, LOTE_COMPLETO));
      expect(error).toMatch(/dado de baja/);
    });
  });

  it("el lote se escribe en el tenant de la fila, aunque el admin sea global", async () => {
    // El admin puede escribir en cualquier cliente; lo que decide en cuál es la
    // fila `importacion`, no el payload. Se prueba con el tenant RIVAL real.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const id = await nuevaImportacion(c, { tenant: TENANTS.rival });
      await aplicar(c, id, {
        ...LOTE_COMPLETO,
        marca: [MARCA],
        cadena: [],
        sku: [],
        tienda: [],
        tienda_sku: [],
        precio_regular: [],
        promocion: [],
      });

      const r = await c.query<{ tenant_id: string }>(
        `select tenant_id from public.marca where codigo_externo = 'IMP-MRC'`,
      );
      expect(r.rows[0]?.tenant_id).toBe(TENANTS.rival);
    });
  });
});

describe("aplicar_importacion — el contrato de seguridad", () => {
  it("`anon` no puede ejecutarla", async () => {
    await db.query("begin");
    try {
      await db.query("set local role anon");
      const error = await alIntentar(db, () =>
        db.query(`select public.aplicar_importacion($1, '{}'::jsonb)`, [
          "a0000017-0000-0000-0000-000000000001",
        ]),
      );
      expect(error).toMatch(/permission denied/i);
    } finally {
      await db.query("rollback");
    }
  });
});
