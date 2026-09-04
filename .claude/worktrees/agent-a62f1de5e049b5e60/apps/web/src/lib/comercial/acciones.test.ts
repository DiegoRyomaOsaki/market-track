import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseFalso } from "@/lib/panel/supabase-falso";

import {
  crearExhibicion,
  crearPrecio,
  crearPromocion,
  editarExhibicion,
  editarPrecio,
  editarPromocion,
} from "./acciones";

// Lo que estas acciones tienen que hacer bien no es escribir —de eso responde la
// RLS, y `packages/db/test/comercial.db.test.ts` la prueba contra Postgres de
// verdad— sino TRADUCIR: el 23505 de una clave natural tiene que llegar al
// operador diciéndole qué campo cambiar, no como "error del sistema".

const { cliente } = vi.hoisted(() => ({
  cliente: { actual: null as object | null },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => Promise.resolve(cliente.actual),
}));

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const SKU = "a0000003-0000-0000-0000-000000000001";
const CADENA = "a0000001-0000-0000-0000-000000000001";
const TIENDA = "a0000002-0000-0000-0000-000000000001";
const MARCA = "cccccccc-0000-0000-0000-000000000001";
const PRECIO_ID = "a0000005-0000-0000-0000-000000000001";

const PRECIO = {
  tenant_id: TENANT,
  sku_id: SKU,
  cadena_id: CADENA,
  precio: 6.9,
  vigente_desde: "2026-09-01",
};

const PROMO = {
  tenant_id: TENANT,
  sku_id: SKU,
  precio_promo: 5.9,
  fecha_inicio: "2026-09-01",
  fecha_fin: "2026-09-30",
};

const EXHIBICION = {
  tenant_id: TENANT,
  tienda_id: TIENDA,
  marca_id: MARCA,
  tipo: "cabecera",
  fecha_inicio: "2026-09-01",
  fecha_fin: "2026-09-30",
};

/** Monta el doble y devuelve sus espías. */
function conRespuesta(
  escritura: {
    data: Record<string, unknown>[] | null;
    error: { message: string; code?: string } | null;
  },
  lecturas?: Record<string, Record<string, unknown>[]>,
) {
  const falso = supabaseFalso({ escritura, lecturas });
  cliente.actual = falso.cliente;
  return falso;
}

const OK = { data: [{ id: "nuevo" }], error: null };

beforeEach(() => {
  vi.restoreAllMocks();
  conRespuesta(OK);
});

describe("crearPrecio", () => {
  it("manda a `precio_regular` exactamente los campos validados", () => {
    const falso = conRespuesta(OK);
    return crearPrecio(PRECIO).then((r) => {
      expect(r.ok).toBe(true);
      expect(falso.tablasPedidas).toContain("precio_regular");
      // `tipo_tienda` viaja como null explícito: es lo que hace colisionar la
      // clave `nulls not distinct` en vez de crear una fila nueva cada vez.
      expect(falso.filasEscritas[0]).toEqual({ ...PRECIO, tipo_tienda: null });
    });
  });

  it("un duplicado se explica en términos del formulario", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    conRespuesta({
      data: null,
      error: {
        message: "duplicate key value ... precio_regular_natural_uq",
        code: "23505",
      },
    });

    const r = await crearPrecio(PRECIO);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/fecha de vigencia/i);
    // El mensaje del motor habla de índices: al operador no se le enseña crudo.
    expect(r.error).not.toMatch(/duplicate key/i);
  });

  it("una referencia de otro cliente se dice tal cual", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    conRespuesta({
      data: null,
      error: { message: "violates foreign key constraint", code: "23503" },
    });

    const r = await crearPrecio(PRECIO);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/no es de este cliente/i);
  });

  it("una escritura que la RLS bloquea NO se da por buena", async () => {
    // PostgREST no da error: afecta a 0 filas y devuelve una lista vacía. Sin
    // esta comprobación la pantalla diría "guardado" y no habría guardado nada.
    conRespuesta({ data: [], error: null });

    const r = await crearPrecio(PRECIO);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/sin permiso/i);
  });

  it("con datos inválidos no llega a tocar la base", async () => {
    const falso = conRespuesta(OK);

    const r = await crearPrecio({ ...PRECIO, precio: -1 });

    expect(r.ok).toBe(false);
    expect(falso.tablasPedidas).toEqual([]);
  });
});

describe("editarPrecio", () => {
  it("apunta a la fila que se está editando", async () => {
    // Un `.eq('id', …)` que se olvide reescribe TODAS las filas que la RLS deje.
    const falso = conRespuesta(OK);

    await editarPrecio(PRECIO_ID, PRECIO);

    expect(falso.filtrosDeEscritura).toEqual([["id", PRECIO_ID]]);
  });
});

describe("crearPromocion", () => {
  it("un duplicado apunta a la fecha de inicio, que es su clave", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    conRespuesta({
      data: null,
      error: { message: "duplicate key", code: "23505" },
    });

    const r = await crearPromocion(PROMO);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/fecha de inicio/i);
  });

  it("los clusters vacíos viajan como lista, no como ausencia", async () => {
    const falso = conRespuesta(OK);

    await crearPromocion(PROMO);

    expect(falso.filasEscritas[0]).toMatchObject({
      clusters: [],
      comunicada: false,
    });
  });
});

describe("crearExhibicion", () => {
  it("un duplicado nombra el tipo, la marca y la tienda", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    conRespuesta({
      data: null,
      error: { message: "duplicate key ... exh_neg_natural_uq", code: "23505" },
    });

    const r = await crearExhibicion(EXHIBICION);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/exhibición de ese tipo/i);
  });

  it("escribe en `exhibicion_negociada`, no en la tabla de lo levantado", async () => {
    // `exhibicion` (sin apellido) es lo que el mercaderista reporta en campo.
    // Confundirlas escribiría el trato negociado como si fuera una observación.
    const falso = conRespuesta(OK);

    await crearExhibicion(EXHIBICION);

    expect(falso.tablasPedidas).toEqual(["exhibicion_negociada"]);
  });

  it("una escritura bloqueada por la RLS no se da por buena", async () => {
    conRespuesta({ data: [], error: null });

    const r = await crearExhibicion(EXHIBICION);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/sin permiso/i);
  });

  it("sin SKUs no consulta el catálogo: no hay nada que comprobar", async () => {
    const falso = conRespuesta(OK);

    await crearExhibicion(EXHIBICION);

    expect(falso.tablasPedidas).not.toContain("sku");
  });
});

describe("crearExhibicion con SKUs", () => {
  // `sku_ids` es un `uuid[]` SIN clave foránea: la base no comprueba de quién es
  // cada elemento. Si esto no lo comprueba el servidor, no lo comprueba nadie —
  // el filtro del formulario es UX y una llamada directa se lo salta.
  const SKU_AJENO = "b0000003-0000-0000-0000-000000000002";

  /** El catálogo tal como lo ve la consulta: cada SKU con su dueño. */
  const CATALOGO = {
    sku: [
      { id: SKU, tenant_id: TENANT },
      { id: SKU_AJENO, tenant_id: "bbbbbbbb-0000-0000-0000-000000000002" },
    ],
  };

  it("rechaza un SKU que no es del cliente de la exhibición", async () => {
    conRespuesta(OK, CATALOGO);

    const r = await crearExhibicion({ ...EXHIBICION, sku_ids: [SKU_AJENO] });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/no es de este cliente/i);
  });

  it("no ESCRIBE nada cuando rechaza", async () => {
    const falso = conRespuesta(OK, CATALOGO);

    await crearExhibicion({ ...EXHIBICION, sku_ids: [SKU_AJENO] });

    expect(falso.filasEscritas).toEqual([]);
  });

  it("acepta los SKUs que sí son del cliente", async () => {
    conRespuesta(OK, CATALOGO);

    const r = await crearExhibicion({ ...EXHIBICION, sku_ids: [SKU] });

    expect(r.ok).toBe(true);
  });

  it("un id repetido no hace fallar la comprobación", async () => {
    // La base devuelve UNA fila por id distinto: comparar contra la longitud
    // cruda rechazaría una lista con un duplicado que sí es del cliente.
    conRespuesta(OK, CATALOGO);

    const r = await crearExhibicion({ ...EXHIBICION, sku_ids: [SKU, SKU] });

    expect(r.ok).toBe(true);
  });

  it("mezclar uno propio con uno ajeno se rechaza entero", async () => {
    conRespuesta(OK, CATALOGO);

    const r = await crearExhibicion({
      ...EXHIBICION,
      sku_ids: [SKU, SKU_AJENO],
    });

    expect(r.ok).toBe(false);
  });
});

describe("las ediciones apuntan a su fila", () => {
  // Un `.eq('id', …)` que se olvide reescribe TODAS las filas que la RLS deje.
  it("editarPromocion", async () => {
    const falso = conRespuesta(OK);

    await editarPromocion("a0000006-0000-0000-0000-000000000001", PROMO);

    expect(falso.filtrosDeEscritura).toEqual([
      ["id", "a0000006-0000-0000-0000-000000000001"],
    ]);
  });

  it("editarExhibicion", async () => {
    const falso = conRespuesta(OK);

    await editarExhibicion("a0000007-0000-0000-0000-000000000001", EXHIBICION);

    expect(falso.filtrosDeEscritura).toEqual([
      ["id", "a0000007-0000-0000-0000-000000000001"],
    ]);
  });
});
