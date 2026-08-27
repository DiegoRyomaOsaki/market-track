import { beforeEach, describe, expect, it, vi } from "vitest";

import { strFromU8, unzipSync } from "fflate";

import { GET } from "./route";

const { estado } = vi.hoisted(() => ({
  estado: {
    sesion: null as { supabase: unknown; perfil: { id: string } } | null,
    modulos: { reportes: true },
    rpc: { data: [] as unknown[], error: null as { message: string } | null },
    argsRpc: null as Record<string, unknown> | null,
  },
}));

vi.mock("@/lib/portal/sesion", () => ({
  sesionDeCliente: () => Promise.resolve(estado.sesion),
}));
vi.mock("@/lib/portal/estado-modulos", () => ({
  modulosDelCliente: () => Promise.resolve(estado.modulos),
}));

const FILA = {
  cumplimiento_pct: 92,
  cumplimiento_pct_prev: 88,
  quiebres: 14,
  quiebres_prev: 19,
  diferencias: 3,
  diferencias_prev: 3,
  sos_pct: 38,
  sos_pct_prev: 36,
  exhib_cumplidas: 4,
  exhib_negociadas: 5,
  exhib_cumplidas_prev: 3,
  exhib_negociadas_prev: 5,
  desviaciones_precio: 2,
  desviaciones_precio_prev: 7,
};

/** Un doble del cliente de Supabase que registra con qué se le llamó. */
function supabaseDoble() {
  return {
    rpc: (_nombre: string, args: Record<string, unknown>) => {
      estado.argsRpc = args;
      return {
        abortSignal: () => Promise.resolve(estado.rpc),
      };
    },
  };
}

/** El texto de la primera hoja del libro, descomprimido. */
function leerHoja(bytes: Buffer): string {
  const zip = unzipSync(new Uint8Array(bytes));
  const hoja = zip["xl/worksheets/sheet1.xml"];
  const compartidas = zip["xl/sharedStrings.xml"];
  return (
    (hoja ? strFromU8(hoja) : "") + (compartidas ? strFromU8(compartidas) : "")
  );
}

const QS = "?desde=2026-08-01&hasta=2026-08-26";

function pedir(qs = QS): Promise<Response> {
  return GET(new Request(`http://localhost/cliente/reportes/excel${qs}`));
}

// Un route handler es un endpoint por sí mismo: que el enlace solo se pinte
// dentro de `/cliente` no lo protege. Aquí se prueba el GATE y el contrato de la
// respuesta; que los KPI sean los correctos lo prueba `reportes.test.ts`, y que
// el aislamiento por tenant funcione lo prueba la RLS en `test:db` — no una
// aserción de esta capa.

beforeEach(() => {
  estado.sesion = { supabase: supabaseDoble(), perfil: { id: "u1" } };
  estado.modulos = { reportes: true };
  estado.rpc = { data: [FILA], error: null };
  estado.argsRpc = null;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /cliente/reportes/excel", () => {
  it("sin sesión de cliente no se lo lleva", async () => {
    estado.sesion = null;
    expect((await pedir()).status).toBe(403);
  });

  it("con el módulo de reportes apagado responde 404, no 403", async () => {
    // 403 confirmaría que la sección existe pero no se contrató. 404 es lo
    // mismo que hace la página con `requerirModulo`.
    estado.modulos = { reportes: false };
    expect((await pedir()).status).toBe(404);
  });

  it("sin las dos fechas no inventa un periodo por defecto", async () => {
    // Exportar un periodo que el usuario no vio en pantalla es la divergencia
    // entre lo mostrado y lo descargado que este diseño existe para evitar.
    expect((await pedir("?desde=2026-08-01")).status).toBe(400);
  });

  it("rechaza el rango invertido", async () => {
    const res = await pedir("?desde=2026-08-26&hasta=2026-08-01");
    expect(res.status).toBe(400);
  });

  it("el 400 no filtra el mensaje crudo del validador", async () => {
    const res = await pedir("?desde=xx&hasta=2026-08-01");
    const cuerpo = await res.text();

    expect(res.status).toBe(400);
    expect(cuerpo).not.toContain("ZodError");
    expect(cuerpo.length).toBeLessThan(80);
  });

  it("si la consulta falla responde 502, no un .xlsx corrupto", async () => {
    estado.rpc = { data: [], error: { message: "connection refused" } };
    const res = await pedir();

    expect(res.status).toBe(502);
    expect(res.headers.get("Content-Type")).not.toContain("spreadsheetml");
  });

  it("sin datos devuelve el archivo igual, no un error", async () => {
    // Un archivo vacío se lee como "no hubo trabajo"; un error se lee como "algo
    // se rompió". Aquí la verdad es la primera, y hay que decirla como tal.
    estado.rpc = { data: [], error: null };
    const res = await pedir();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
  });

  it("devuelve un .xlsx de verdad con nombre y sin caché", async () => {
    const res = await pedir();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml.sheet");
    expect(res.headers.get("Content-Disposition")).toContain(
      'filename="reporte-market-track-2026-08-01-2026-08-26.xlsx"',
    );
    // Lleva datos del tenant: cachearlo cruza clientes.
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const bytes = Buffer.from(await res.arrayBuffer());
    // "PK": la firma de un zip, que es lo que un .xlsx es por dentro.
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
  });

  it("el nombre del archivo NO lleva texto de la base de datos", async () => {
    // Va en una cabecera: una comilla o un salto de línea dentro del nombre del
    // cliente sería inyección de cabecera.
    const disp = (await pedir()).headers.get("Content-Disposition") ?? "";
    expect(disp).toMatch(/^attachment; filename="[a-z0-9-]+\.xlsx"$/);
  });

  it("los filtros de cadena y tienda llegan a la consulta", async () => {
    await pedir(
      `${QS}&cadena=a0000002-0000-0000-0000-000000000001&tienda=a0000002-0000-0000-0000-000000000002`,
    );

    expect(estado.argsRpc?.p_cadena).toBe(
      "a0000002-0000-0000-0000-000000000001",
    );
    expect(estado.argsRpc?.p_tienda).toBe(
      "a0000002-0000-0000-0000-000000000002",
    );
  });

  it("una cadena que no es un id se rechaza antes de tocar la base", async () => {
    const res = await pedir(`${QS}&cadena=' or 1=1--`);

    expect(res.status).toBe(400);
    expect(estado.argsRpc).toBeNull();
  });

  it("varios kpi en la URL NO se colapsan en el último", async () => {
    // `Object.fromEntries` se queda con el último valor repetido: con él, este
    // Excel habría salido con un indicador menos que la vista previa.
    const res = await pedir(`${QS}&kpi=sos&kpi=precio`);
    expect(res.status).toBe(200);

    // El .xlsx va comprimido: hay que abrir el zip para leer la hoja.
    const hoja = leerHoja(Buffer.from(await res.arrayBuffer()));
    expect(hoja).toContain("Share of Shelf");
    expect(hoja).toContain("Desviaciones de precio");
  });

  it("un kpi inventado se rechaza en vez de devolver los seis en silencio", async () => {
    expect((await pedir(`${QS}&kpi=inventado`)).status).toBe(400);
  });
});
