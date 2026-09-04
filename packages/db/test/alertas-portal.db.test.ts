import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// La bandeja de alertas del portal: qué ve el cliente-marca, en qué orden, y qué
// pasa cuando el payload no trae lo que debería.

const VISITA_MRC = "a0000010-0000-0000-0000-000000000001";
const LEVANTAMIENTO_MRC = "a0000011-0000-0000-0000-000000000001";
const TIENDA_MRC = "a0000002-0000-0000-0000-000000000001";
const CADENA_MRC = "a0000001-0000-0000-0000-000000000001";
const MARCA_MRC = "cccccccc-0000-0000-0000-000000000001";
const SKU_MRC = "a0000003-0000-0000-0000-000000000001";

// Los del rival. Existen de verdad: un id inventado demostraría "no existe", no
// "no tienes acceso".
const TIENDA_RIVAL = "b0000002-0000-0000-0000-000000000002";
const CADENA_RIVAL = "b0000001-0000-0000-0000-000000000002";

const TODO = ["2020-01-01", "2030-01-01"] as const;

type Fila = {
  id: string;
  tipo: string;
  severidad: string;
  estado: string;
  creado_at: string;
  tienda_nombre: string | null;
  cadena_nombre: string | null;
  marca_nombre: string | null;
  sku_codigo: string | null;
  sku_nombre: string | null;
  total: string;
};

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

async function bandeja(
  c: Client,
  args: {
    desde?: string;
    hasta?: string;
    cadena?: string | null;
    tienda?: string | null;
    tipo?: string | null;
    severidad?: string | null;
    estado?: string | null;
    pagina?: number;
    porPagina?: number;
  } = {},
): Promise<Fila[]> {
  const r = await c.query<Fila>(
    `select * from public.bandeja_alertas(
       $1::date, $2::date, $3, $4,
       $5::public.tipo_alerta, $6::public.severidad_alerta,
       $7::public.estado_alerta, $8, $9)`,
    [
      args.desde ?? TODO[0],
      args.hasta ?? TODO[1],
      args.cadena ?? null,
      args.tienda ?? null,
      args.tipo ?? null,
      args.severidad ?? null,
      args.estado ?? null,
      args.pagina ?? 1,
      args.porPagina ?? 50,
    ],
  );
  return r.rows;
}

/** Inserta una alerta con control total, como hace el motor (service_role). */
async function sembrarAlerta(
  c: Client,
  a: {
    id: string;
    tipo: string;
    payload?: object;
    creado_at?: string;
    severidad?: string;
    estado?: string;
    marca?: string | null;
    visita?: string | null;
    tenant?: string;
  },
): Promise<void> {
  await c.query("set local role postgres");
  await c.query(
    `insert into public.alerta
       (id, tenant_id, tipo, severidad, estado, marca_id, visita_id, payload, creado_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9::timestamptz, now()))`,
    [
      a.id,
      a.tenant ?? TENANTS.maracumango,
      a.tipo,
      a.severidad ?? "info",
      a.estado ?? "nueva",
      a.marca === undefined ? MARCA_MRC : a.marca,
      a.visita === undefined ? VISITA_MRC : a.visita,
      JSON.stringify(a.payload ?? {}),
      a.creado_at ?? null,
    ],
  );
  await c.query("set local role authenticated");
}

describe("bandeja_alertas — qué ve el cliente-marca", () => {
  it("ve las alertas de SU cliente y ninguna del rival", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      const filas = await bandeja(c);
      expect(filas.length).toBeGreaterThan(0);
      expect(filas.every((f) => f.tienda_nombre !== "Tottus Angamos")).toBe(
        true,
      );
      expect(filas.every((f) => f.marca_nombre !== "Marca Rival")).toBe(true);
    });
  });

  it("pedir la tienda o la cadena REALES del rival no devuelve nada", async () => {
    // La tienda existe y tiene alertas. Lo único que la esconde es la RLS.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      expect(await bandeja(c, { tienda: TIENDA_RIVAL })).toEqual([]);
      expect(await bandeja(c, { cadena: CADENA_RIVAL })).toEqual([]);
    });
  });

  it("el supervisor las ve de todos los clientes: su trabajo es el conjunto", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const marcas = new Set((await bandeja(c)).map((f) => f.marca_nombre));
      expect(marcas.size).toBeGreaterThan(1);
    });
  });
});

describe("bandeja_alertas — la ventana de fechas", () => {
  it("es el día de LIMA, no el de UTC", async () => {
    // 21:00 en Lima del día 4 son las 02:00 UTC del día 5. Si la ventana se
    // resolviera en UTC, esta alerta se contabilizaría en el día equivocado.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await sembrarAlerta(c, {
        id: "e0000016-0000-0000-0000-0000000000a1",
        tipo: "quiebre",
        creado_at: "2026-08-05T02:00:00Z",
      });

      const suDia = await bandeja(c, {
        desde: "2026-08-04",
        hasta: "2026-08-04",
      });
      const elSiguiente = await bandeja(c, {
        desde: "2026-08-05",
        hasta: "2026-08-05",
      });

      expect(suDia.map((f) => f.id)).toContain(
        "e0000016-0000-0000-0000-0000000000a1",
      );
      expect(elSiguiente.map((f) => f.id)).not.toContain(
        "e0000016-0000-0000-0000-0000000000a1",
      );
    });
  });

  it("una ventana sin alertas devuelve la bandeja vacía", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      expect(
        await bandeja(c, { desde: "2019-01-01", hasta: "2019-01-31" }),
      ).toEqual([]);
    });
  });
});

describe("bandeja_alertas — filtros", () => {
  it("cada filtro acota, y combinados también", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await sembrarAlerta(c, {
        id: "e0000016-0000-0000-0000-0000000000b1",
        tipo: "desviacion_precio",
        severidad: "critica",
        estado: "resuelta",
      });

      const porTipo = await bandeja(c, { tipo: "desviacion_precio" });
      expect(porTipo.every((f) => f.tipo === "desviacion_precio")).toBe(true);

      const porSeveridad = await bandeja(c, { severidad: "critica" });
      expect(porSeveridad.every((f) => f.severidad === "critica")).toBe(true);

      const porEstado = await bandeja(c, { estado: "resuelta" });
      expect(porEstado.every((f) => f.estado === "resuelta")).toBe(true);

      const combinado = await bandeja(c, {
        tipo: "desviacion_precio",
        severidad: "critica",
        estado: "resuelta",
      });
      expect(combinado.map((f) => f.id)).toEqual([
        "e0000016-0000-0000-0000-0000000000b1",
      ]);
    });
  });

  it("filtra por tienda y por cadena", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      expect((await bandeja(c, { tienda: TIENDA_MRC })).length).toBeGreaterThan(
        0,
      );
      expect((await bandeja(c, { cadena: CADENA_MRC })).length).toBeGreaterThan(
        0,
      );
    });
  });
});

describe("bandeja_alertas — paginación", () => {
  it("`total` cuenta la ventana entera, no la página", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      const todas = await bandeja(c);
      const primera = await bandeja(c, { porPagina: 1 });

      expect(primera).toHaveLength(1);
      expect(Number(primera[0]!.total)).toBe(todas.length);
    });
  });

  it("con `creado_at` IDÉNTICO el orden lo fija el id, y las páginas no se solapan", async () => {
    // Las ~40 alertas de un mismo levantamiento nacen en la misma transacción y
    // comparten `creado_at` al milisegundo, así que "las N más recientes" solo es
    // un conjunto estable si algo desempata.
    //
    // Lo que este test SÍ demuestra es el orden pactado (id descendente). Que el
    // desempate evite barajar entre páginas no es observable aquí: el índice
    // `(tenant_id, creado_at desc, id desc)` ya devuelve ese mismo orden, así que
    // quitarlo del ORDER BY no cambia nada mientras el plan use el índice. El
    // desempate sigue siendo necesario —un plan distinto reordena— pero es una
    // garantía semántica, no algo que una sola sesión pueda provocar.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      const momento = "2026-07-01T15:00:00Z";
      for (const n of ["c1", "c2", "c3"]) {
        await sembrarAlerta(c, {
          id: `e0000016-0000-0000-0000-0000000000${n}`,
          tipo: "quiebre",
          creado_at: momento,
        });
      }

      const rango = { desde: "2026-07-01", hasta: "2026-07-01" };
      const p1 = await bandeja(c, { ...rango, porPagina: 2, pagina: 1 });
      const p2 = await bandeja(c, { ...rango, porPagina: 2, pagina: 2 });
      const ids = [...p1, ...p2].map((f) => f.id);

      expect(p1).toHaveLength(2);
      expect(p2).toHaveLength(1);
      expect(ids).toEqual([
        "e0000016-0000-0000-0000-0000000000c3",
        "e0000016-0000-0000-0000-0000000000c2",
        "e0000016-0000-0000-0000-0000000000c1",
      ]);
    });
  });

  it("acota el tamaño de página: la RPC es alcanzable sin pasar por la UI", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      const enorme = await bandeja(c, { porPagina: 5000 });
      expect(enorme.length).toBeLessThanOrEqual(100);

      // Página 0 y negativa se tratan como la primera, no como un offset negativo.
      const cero = await bandeja(c, { pagina: 0, porPagina: 1 });
      const uno = await bandeja(c, { pagina: 1, porPagina: 1 });
      expect(cero[0]?.id).toBe(uno[0]?.id);
    });
  });
});

describe("bandeja_alertas — los huecos del payload y de las FK", () => {
  it("una alerta SIN visita aparece igual, con la tienda en null", async () => {
    // `visita_id` es nullable. Con un INNER join —como hace `dashboard_alertas`—
    // la alerta desaparecería de la bandeja sin que nadie se entere.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await sembrarAlerta(c, {
        id: "e0000016-0000-0000-0000-0000000000d1",
        tipo: "contingencia",
        visita: null,
        marca: null,
      });

      const suya = (await bandeja(c)).find(
        (f) => f.id === "e0000016-0000-0000-0000-0000000000d1",
      );
      expect(suya).toBeDefined();
      expect(suya?.tienda_nombre).toBeNull();
    });
  });

  it("una contingencia de la VISITA no cuelga de ninguna marca y se ve igual", async () => {
    // Caso real y frecuente: el bypass en el check-in o el check-out.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await sembrarAlerta(c, {
        id: "e0000016-0000-0000-0000-0000000000e1",
        tipo: "contingencia",
        marca: null,
      });

      const suya = (await bandeja(c)).find(
        (f) => f.id === "e0000016-0000-0000-0000-0000000000e1",
      );
      expect(suya?.marca_nombre).toBeNull();
      expect(suya?.tienda_nombre).toBeTruthy();
    });
  });

  it("resuelve el SKU del payload, y un `sku_id` con basura no tumba la consulta", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await sembrarAlerta(c, {
        id: "e0000016-0000-0000-0000-0000000000f1",
        tipo: "quiebre",
        payload: { sku_id: SKU_MRC },
      });
      await sembrarAlerta(c, {
        id: "e0000016-0000-0000-0000-0000000000f2",
        tipo: "quiebre",
        payload: { sku_id: "no-soy-un-uuid" },
      });

      const filas = await bandeja(c);
      const buena = filas.find(
        (f) => f.id === "e0000016-0000-0000-0000-0000000000f1",
      );
      const basura = filas.find(
        (f) => f.id === "e0000016-0000-0000-0000-0000000000f2",
      );

      expect(buena?.sku_codigo).toBeTruthy();
      expect(buena?.sku_nombre).toBeTruthy();
      // La fila sale igual: el hueco es del payload, no de la alerta.
      expect(basura).toBeDefined();
      expect(basura?.sku_codigo).toBeNull();
    });
  });
});

describe("detalle_alerta", () => {
  async function detalle(
    c: Client,
    id: string,
  ): Promise<Record<string, unknown> | null> {
    const r = await c.query<{ d: Record<string, unknown> | null }>(
      `select public.detalle_alerta($1) as d`,
      [id],
    );
    return r.rows[0]?.d ?? null;
  }

  it("trae el payload CRUDO más lo que hace falta para leerlo", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await sembrarAlerta(c, {
        id: "e0000016-0000-0000-0000-00000000a001",
        tipo: "desviacion_precio",
        payload: {
          sku_id: SKU_MRC,
          precio_registrado: 12.9,
          precio_regular: 9.9,
          motivo: "sobreprecio",
        },
      });

      const d = await detalle(c, "e0000016-0000-0000-0000-00000000a001");
      expect(d?.payload).toMatchObject({
        precio_registrado: 12.9,
        precio_regular: 9.9,
        motivo: "sobreprecio",
      });
      expect(d?.sku_codigo).toBeTruthy();
      expect(d?.tienda_nombre).toBeTruthy();
    });
  });

  it("dice DESDE CUÁNDO regía el precio esperado, a la fecha de la visita", async () => {
    // Sin la ventana, un precio que cambió en agosto y una alerta de julio se
    // leen como una contradicción. Se resuelve a la fecha de la VISITA y no a
    // la de hoy: es la que el motor usó para decidir.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await sembrarAlerta(c, {
        id: "e0000016-0000-0000-0000-00000000a007",
        tipo: "desviacion_precio",
        payload: {
          sku_id: SKU_MRC,
          precio_registrado: 12.9,
          precio_regular: 6.9,
        },
      });

      const d = await detalle(c, "e0000016-0000-0000-0000-00000000a007");
      expect(d?.precio_vigente_desde).toBe("2026-01-01");
      // El periodo del seed sigue abierto: nulo significa "sigue vigente", no
      // que falte el dato.
      expect(d?.precio_vigente_hasta).toBeNull();
    });
  });

  it("una alerta del RIVAL y una inexistente devuelven lo mismo: null", async () => {
    // Indistinguibles a propósito: distinguirlas confirmaría que la ajena existe.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      expect(
        await detalle(c, "b0000016-0000-0000-0000-000000000002"),
      ).toBeNull();
      expect(
        await detalle(c, "eeeeeeee-0000-0000-0000-00000000ffff"),
      ).toBeNull();
    });
  });

  it("la CONTINGENCIA trae su propia foto: es la única FK de foto que el móvil rellena", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await c.query("set local role postgres");
      const foto = await c.query<{ id: string }>(
        `insert into public.foto (tenant_id, visita_id, tipo, capturada_at)
         values ($1, $2, 'contingencia', now()) returning id`,
        [TENANTS.maracumango, VISITA_MRC],
      );
      await c.query(
        `insert into public.contingencia
           (tenant_id, visita_id, paso, motivo, registrada_at, foto_id)
         values ($1, $2, 'precios', 'Góndola bloqueada', now(), $3)`,
        [TENANTS.maracumango, VISITA_MRC, foto.rows[0]!.id],
      );
      await c.query("set local role authenticated");

      // El trigger de contingencia ya creó su alerta; se busca por el motivo.
      const suya = (await bandeja(c)).find((f) => f.tipo === "contingencia");
      const d = await detalle(c, suya!.id);
      const f = d?.foto as { id: string; del_hallazgo: boolean } | null;

      expect(f).not.toBeNull();
      expect(f?.del_hallazgo).toBe(true);
    });
  });

  it("la de PRECIO trae la foto del paso, marcada como NO específica del hallazgo", async () => {
    // No existe enlace exacto: el móvil no escribe `sos_foto_id`. Enseñarla como
    // si fuera la del SKU sería inventarse la evidencia, así que se rotula.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await c.query("set local role postgres");
      await c.query(
        `insert into public.foto (tenant_id, visita_id, levantamiento_id, tipo, capturada_at)
         values ($1, $2, $3, 'precio', now())`,
        [TENANTS.maracumango, VISITA_MRC, LEVANTAMIENTO_MRC],
      );
      await c.query("set local role authenticated");

      await sembrarAlerta(c, {
        id: "e0000016-0000-0000-0000-00000000a002",
        tipo: "desviacion_precio",
        payload: { sku_id: SKU_MRC },
      });

      const d = await detalle(c, "e0000016-0000-0000-0000-00000000a002");
      const f = d?.foto as { del_hallazgo: boolean } | null;
      expect(f).not.toBeNull();
      expect(f?.del_hallazgo).toBe(false);
    });
  });

  it("sin foto que enseñar devuelve null, no un error", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await sembrarAlerta(c, {
        id: "e0000016-0000-0000-0000-00000000a003",
        tipo: "quiebre",
        marca: null,
        visita: null,
      });
      const d = await detalle(c, "e0000016-0000-0000-0000-00000000a003");
      expect(d?.foto).toBeNull();
    });
  });

  it("la SELFIE no sale por ninguno de estos caminos", async () => {
    // La cara del mercaderista no es evidencia de tienda. Desde la galería la
    // política se la oculta al cliente; aquí se comprueba que además ningún
    // camino de esta RPC la seleccionaría.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await c.query("set local role postgres");
      await c.query(
        `insert into public.foto (tenant_id, visita_id, levantamiento_id, tipo, capturada_at)
         values ($1, $2, $3, 'selfie', now())`,
        [TENANTS.maracumango, VISITA_MRC, LEVANTAMIENTO_MRC],
      );
      await c.query("set local role authenticated");

      await sembrarAlerta(c, {
        id: "e0000016-0000-0000-0000-00000000a004",
        tipo: "quiebre",
        payload: { sku_id: SKU_MRC },
      });

      const d = await detalle(c, "e0000016-0000-0000-0000-00000000a004");
      const f = d?.foto as { id: string } | null;
      if (f !== null) {
        const tipo = await c.query<{ tipo: string }>(
          `select tipo from public.foto where id = $1`,
          [f.id],
        );
        expect(tipo.rows[0]?.tipo).not.toBe("selfie");
      }
    });
  });
});
