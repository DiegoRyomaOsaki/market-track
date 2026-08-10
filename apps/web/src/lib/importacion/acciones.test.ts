import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { construirXlsx } from "./__fixtures__/xlsx";
import { aplicarImportacion, validarImportacion } from "./acciones";

// Las dos operaciones del importador. Lo que más importa aquí es lo que NO puede
// pasar: aplicar un archivo distinto del que se revisó, o dar por bueno un
// resultado que la RLS bloqueó en silencio.

type ErrorFalso = { message: string } | null;
type SesionFalsa = { supabase: unknown; perfil: unknown } | null;

const { sesion, rpc, consultas } = vi.hoisted(() => ({
  sesion: { actual: null as SesionFalsa },
  rpc: { data: {}, error: null as ErrorFalso },
  consultas: {
    importacion: {
      data: null as { archivo_hash: string } | null,
      error: null as ErrorFalso,
    },
    insertados: [] as Record<string, unknown>[],
    llamadas: [] as { nombre: string; argumentos: unknown }[],
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/panel/sesion", () => ({
  sesionDeStaff: () => Promise.resolve(sesion.actual),
}));

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const IMPORTACION = "a0000017-0000-0000-0000-000000000001";

/** Un maestro mínimo pero válido: una marca sola no referencia nada. */
function archivoValido() {
  return construirXlsx([
    {
      nombre: "marca",
      filas: [
        ["codigo_externo", "nombre", "tolerancia_precio_pct"],
        ["MRC", "Maracumango", 5],
      ],
    },
  ]);
}

function archivoConError() {
  return construirXlsx([
    {
      nombre: "marca",
      filas: [
        ["codigo_externo", "nombre"],
        ["", "Sin código"],
      ],
    },
  ]);
}

function clienteFalso() {
  const lectura = (tabla: string) => {
    const encadenable = {
      select: () => encadenable,
      eq: () => encadenable,
      in: () => Promise.resolve({ data: [], error: null }),
      maybeSingle: () =>
        Promise.resolve(
          tabla === "importacion"
            ? consultas.importacion
            : { data: null, error: null },
        ),
      insert: (filas: Record<string, unknown>) => {
        consultas.insertados.push(filas);
        return {
          select: () =>
            Promise.resolve({ data: [{ id: IMPORTACION }], error: null }),
        };
      },
      update: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
    };
    return encadenable;
  };

  return {
    from: (tabla: string) => lectura(tabla),
    rpc: (nombre: string, argumentos: unknown) => {
      consultas.llamadas.push({ nombre, argumentos });
      return Promise.resolve({ data: rpc.data, error: rpc.error });
    },
  };
}

function conRol(rol: string) {
  sesion.actual = {
    supabase: clienteFalso(),
    perfil: { id: "admin-1", rol, nombre: "Admin" },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  rpc.data = { marca: 1 };
  rpc.error = null;
  consultas.importacion = { data: null, error: null };
  consultas.insertados = [];
  consultas.llamadas = [];
  conRol("admin");
});

describe("validarImportacion", () => {
  it("no escribe en el maestro: solo deja constancia de lo revisado", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const r = await validarImportacion({ tenantId: TENANT }, archivoValido());

    expect(r.ok).toBe(true);
    // Ni una llamada a la función que aplica.
    expect(consultas.llamadas).toEqual([]);
  });

  it("guarda el hash que calcula el SERVIDOR", async () => {
    // Si viniera del cliente, la comprobación de «es el mismo archivo» al aplicar
    // no valdría nada: bastaría con mandar el hash del que se revisó.
    vi.spyOn(console, "info").mockImplementation(() => {});
    const archivo = archivoValido();
    await validarImportacion({ tenantId: TENANT }, archivo);

    expect(consultas.insertados[0]?.archivo_hash).toBe(
      createHash("sha256").update(archivo).digest("hex"),
    );
  });

  it("un archivo con errores queda en `con_errores`, no en `previsualizada`", async () => {
    // El estado es lo que impide aplicarlo: la guarda vive en la base.
    vi.spyOn(console, "info").mockImplementation(() => {});
    const r = await validarImportacion({ tenantId: TENANT }, archivoConError());

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.errores.length).toBeGreaterThan(0);
    expect(consultas.insertados[0]?.estado).toBe("con_errores");
  });

  it("un archivo limpio queda `previsualizada` y con su resumen", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const r = await validarImportacion({ tenantId: TENANT }, archivoValido());

    expect(consultas.insertados[0]?.estado).toBe("previsualizada");
    if (!r.ok) return;
    expect(r.resumen).toMatchObject({ marca: 1 });
  });

  it("guarda los errores en la forma que la pantalla espera", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await validarImportacion({ tenantId: TENANT }, archivoConError());

    const errores = consultas.insertados[0]?.errores;
    const primero: unknown = Array.isArray(errores) ? errores[0] : null;
    // La fila 2 del Excel: la 1 es la cabecera. Es el número que el operador ve.
    expect(primero).toMatchObject({
      hoja: "marca",
      fila: 2,
      columna: "codigo_externo",
    });
  });

  it("un supervisor no importa el maestro", async () => {
    conRol("supervisor");
    const r = await validarImportacion({ tenantId: TENANT }, archivoValido());

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/administrador/i);
  });

  it("sin sesión tampoco", async () => {
    sesion.actual = null;
    expect(
      (await validarImportacion({ tenantId: TENANT }, archivoValido())).ok,
    ).toBe(false);
  });

  it("un tenant que no es un uuid se rechaza antes de leer el archivo", async () => {
    expect(
      (await validarImportacion({ tenantId: "../../otro" }, archivoValido()))
        .ok,
    ).toBe(false);
  });

  it("un archivo enorme se rechaza sin descomprimirlo", async () => {
    const r = await validarImportacion(
      { tenantId: TENANT },
      Buffer.alloc(3 * 1024 * 1024),
    );
    expect(r.ok).toBe(false);
  });

  it("un archivo que no es un Excel da un error legible", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await validarImportacion(
      { tenantId: TENANT },
      Buffer.from("no soy un xlsx"),
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/no pudimos leer el archivo/i);
  });
});

describe("aplicarImportacion", () => {
  function conHashDe(archivo: Buffer) {
    consultas.importacion = {
      data: {
        archivo_hash: createHash("sha256").update(archivo).digest("hex"),
      },
      error: null,
    };
  }

  it("aplica el lote y devuelve el resumen de la base", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const archivo = archivoValido();
    conHashDe(archivo);

    const r = await aplicarImportacion({ importacionId: IMPORTACION }, archivo);

    expect(r).toEqual({ ok: true, resumen: { marca: 1 } });
    expect(consultas.llamadas[0]?.nombre).toBe("aplicar_importacion");
  });

  it("APLICAR UN ARCHIVO DISTINTO del revisado se rechaza", async () => {
    // Es el agujero que cierra el hash: el operador revisaría unos errores y
    // aplicaría otros datos.
    conHashDe(archivoValido());

    const otro = construirXlsx([
      {
        nombre: "marca",
        filas: [
          ["codigo_externo", "nombre"],
          ["OTRA", "Otra marca"],
        ],
      },
    ]);
    const r = await aplicarImportacion({ importacionId: IMPORTACION }, otro);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/no es el que se revisó/i);
    expect(consultas.llamadas).toEqual([]);
  });

  it("re-valida al aplicar: no se fía de lo que dijo la previsualización", async () => {
    const archivo = archivoConError();
    conHashDe(archivo);

    const r = await aplicarImportacion({ importacionId: IMPORTACION }, archivo);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/tiene errores/i);
    expect(consultas.llamadas).toEqual([]);
  });

  it("una importación que no existe o es ajena da el MISMO mensaje", async () => {
    consultas.importacion = { data: null, error: null };
    const r = await aplicarImportacion(
      { importacionId: IMPORTACION },
      archivoValido(),
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/sin permiso/i);
  });

  it("si la función de Postgres aborta, el motivo se anota y no se enseña crudo", async () => {
    // El mensaje del motor habla de contadores de filas: al operador se le dice
    // qué pasó en sus términos, y el detalle queda registrado.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const archivo = archivoValido();
    conHashDe(archivo);
    rpc.error = { message: "sku: llegaron 3 filas y se escribieron 1" };

    const r = await aplicarImportacion({ importacionId: IMPORTACION }, archivo);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).not.toContain("llegaron 3 filas");
    expect(String(error.mock.calls[0]?.[1])).toContain("llegaron 3 filas");
  });

  it("un id que no es uuid se rechaza antes de tocar nada", async () => {
    const r = await aplicarImportacion(
      { importacionId: "../../otra" },
      archivoValido(),
    );
    expect(r.ok).toBe(false);
    expect(consultas.llamadas).toEqual([]);
  });

  it("un supervisor no aplica el maestro", async () => {
    conRol("supervisor");
    const r = await aplicarImportacion(
      { importacionId: IMPORTACION },
      archivoValido(),
    );
    expect(r.ok).toBe(false);
  });
});
