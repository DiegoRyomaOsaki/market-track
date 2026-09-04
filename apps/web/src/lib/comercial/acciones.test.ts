import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseFalso } from "@/lib/panel/supabase-falso";

import {
  abrirPeriodoPrecio,
  crearExhibicion,
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

/** Monta el doble para una acción que entra por RPC en vez de por la tabla. */
function conRpc(rpc: {
  data?: unknown;
  error: { message: string; code?: string } | null;
}) {
  const falso = supabaseFalso({ rpc });
  cliente.actual = falso.cliente;
  return falso;
}

/** Lo que el formulario manda para abrir un periodo: sin `tenant_id`. */
const APERTURA = {
  sku_id: SKU,
  cadena_id: CADENA,
  precio: 7.9,
  vigente_desde: "2026-10-01",
};

const OK = { data: [{ id: "nuevo" }], error: null };

beforeEach(() => {
  vi.restoreAllMocks();
  conRespuesta(OK);
});

describe("abrirPeriodoPrecio", () => {
  it("entra por la RPC y no por un insert: cerrar y abrir es UNA operación", async () => {
    // Dos escrituras sueltas dejarían al SKU sin ningún precio vigente si la
    // segunda falla — y eso no da error en ninguna pantalla, sale del
    // denominador de Perfect Store en silencio.
    const falso = conRpc({ error: null });

    const r = await abrirPeriodoPrecio(APERTURA);

    expect(r.ok).toBe(true);
    expect(falso.rpcsPedidas[0]?.nombre).toBe("abrir_periodo_precio");
    expect(falso.tablasPedidas).not.toContain("precio_regular");
  });

  it("omite `p_tipo_tienda` cuando el precio es de toda la cadena", async () => {
    // El default de la función ya es null; mandarlo explícito solo obligaría al
    // tipo generado a admitir un null que no admite.
    const falso = conRpc({ error: null });

    await abrirPeriodoPrecio(APERTURA);

    expect(falso.rpcsPedidas[0]?.argumentos).toEqual({
      p_sku: SKU,
      p_cadena: CADENA,
      p_precio: 7.9,
      p_vigente_desde: "2026-10-01",
    });
  });

  it("lo manda cuando el precio es de un tipo de tienda", async () => {
    const falso = conRpc({ error: null });

    await abrirPeriodoPrecio({ ...APERTURA, tipo_tienda: "hiper" });

    expect(falso.rpcsPedidas[0]?.argumentos).toMatchObject({
      p_tipo_tienda: "hiper",
    });
  });

  it("no llega a la red si el cuerpo no valida", async () => {
    const falso = conRpc({ error: null });

    const r = await abrirPeriodoPrecio({ ...APERTURA, sku_id: "no-es-un-id" });

    expect(r.ok).toBe(false);
    expect(falso.rpcsPedidas).toHaveLength(0);
  });

  it("una fecha que no es posterior a la vigente se explica con el texto de la base", async () => {
    // La RPC ya redacta ese caso mejor que un mensaje genérico: dice DESDE
    // cuándo hay precio.
    vi.spyOn(console, "error").mockImplementation(() => {});
    conRpc({
      error: {
        message:
          "ya hay un precio para ese SKU y esa cadena desde el 2026-01-01 o posterior: el periodo nuevo tiene que empezar después",
        code: "23514",
      },
    });

    const r = await abrirPeriodoPrecio(APERTURA);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/empezar después/);
  });

  it("un solapamiento se explica en términos del formulario", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    conRpc({
      error: {
        message:
          'conflicting key value violates exclusion constraint "precio_regular_sin_solape_general"',
        code: "23P01",
      },
    });

    const r = await abrirPeriodoPrecio(APERTURA);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/se solapa/i);
    // El mensaje del motor habla de restricciones: al operador no se le enseña.
    expect(r.error).not.toMatch(/exclusion constraint/i);
  });
});

describe("editarPrecio", () => {
  it("un duplicado se explica en términos del formulario", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    conRespuesta({
      data: null,
      error: {
        message: "duplicate key value ... precio_regular_natural_uq",
        code: "23505",
      },
    });

    const r = await editarPrecio(PRECIO_ID, PRECIO);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/fecha de vigencia/i);
    // El mensaje del motor habla de índices: al operador no se le enseña crudo.
    expect(r.error).not.toMatch(/duplicate key/i);
  });

  it("reescribir un precio que ya rigió se explica, no se traga", async () => {
    // La verja vive en la base: aquí solo se comprueba que el 23514 del trigger
    // llega al operador diciéndole qué hacer en vez de "error del sistema".
    vi.spyOn(console, "error").mockImplementation(() => {});
    conRespuesta({
      data: null,
      error: {
        message:
          "ese precio ya rigió desde el 2026-01-01 y no se puede reescribir",
        code: "23514",
      },
    });

    const r = await editarPrecio(PRECIO_ID, PRECIO);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/periodo nuevo/i);
  });

  it("reescribir una promoción que ya arrancó también", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    conRespuesta({
      data: null,
      error: {
        message:
          "esa promoción ya arrancó el 2026-07-01 y no se puede reescribir",
        code: "23514",
      },
    });

    const r = await editarPromocion(PRECIO_ID, PROMO);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/crea una nueva/i);
  });

  it("una referencia de otro cliente se dice tal cual", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    conRespuesta({
      data: null,
      error: { message: "violates foreign key constraint", code: "23503" },
    });

    const r = await editarPrecio(PRECIO_ID, PRECIO);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/no es de este cliente/i);
  });

  it("una escritura que la RLS bloquea NO se da por buena", async () => {
    // PostgREST no da error: afecta a 0 filas y devuelve una lista vacía. Sin
    // esta comprobación la pantalla diría "guardado" y no habría guardado nada.
    conRespuesta({ data: [], error: null });

    const r = await editarPrecio(PRECIO_ID, PRECIO);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/sin permiso/i);
  });

  it("con datos inválidos no llega a tocar la base", async () => {
    const falso = conRespuesta(OK);

    const r = await editarPrecio(PRECIO_ID, { ...PRECIO, precio: -1 });

    expect(r.ok).toBe(false);
    expect(falso.tablasPedidas).toEqual([]);
  });

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
