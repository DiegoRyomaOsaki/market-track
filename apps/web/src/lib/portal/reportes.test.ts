import { describe, expect, it } from "vitest";

import type { FilaKpis } from "./dashboard";
import {
  armarReporte,
  CLAVES_KPI,
  filasDelReporte,
  leerKpis,
  nombreDeArchivo,
  reporteQuerySchema,
  serializarReporte,
} from "./reportes";

const PERIODO = { desde: "2026-08-01", hasta: "2026-08-26" };

function fila(over: Partial<FilaKpis> = {}): FilaKpis {
  return {
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
    ...over,
  };
}

describe("leerKpis", () => {
  it("sin el parámetro devuelve null, que significa «todos»", () => {
    // Distinto de `[]`. Si los dos colapsaran, un `?kpi=inventado` devolvería
    // los seis indicadores en silencio en vez de avisar.
    expect(leerKpis({})).toBeNull();
  });

  it("con basura devuelve la lista VACÍA, no null", () => {
    expect(leerKpis({ kpi: "inventado" })).toEqual([]);
  });

  it("acepta uno solo y también una lista", () => {
    expect(leerKpis({ kpi: "quiebres" })).toEqual(["quiebres"]);
    expect(leerKpis({ kpi: ["quiebres", "sos"] })).toEqual(["quiebres", "sos"]);
  });

  it("ignora el orden de la URL y respeta el del catálogo", () => {
    // El orden del reporte es decisión del producto, no de quien escribe el
    // enlace.
    expect(leerKpis({ kpi: ["precio", "cumplimiento"] })).toEqual([
      "cumplimiento",
      "precio",
    ]);
  });

  it("descarta lo inválido y conserva lo válido", () => {
    expect(leerKpis({ kpi: ["sos", "inventado"] })).toEqual(["sos"]);
  });

  it("deduplica", () => {
    expect(leerKpis({ kpi: ["sos", "sos"] })).toEqual(["sos"]);
  });
});

describe("armarReporte", () => {
  it("sin selección entran los seis indicadores", () => {
    expect(armarReporte(fila(), null, PERIODO).filas).toHaveLength(
      CLAVES_KPI.length,
    );
  });

  it("con selección entran solo esos, en el orden del catálogo", () => {
    const r = armarReporte(fila(), ["precio", "cumplimiento"], PERIODO);
    expect(r.filas.map((f) => f.clave)).toEqual(["cumplimiento", "precio"]);
  });

  it("sin fila de la base el reporte queda vacío, no revienta", () => {
    expect(armarReporte(null, null, PERIODO).filas).toEqual([]);
  });

  it("la variación lleva signo Y palabra, nunca solo el número", () => {
    // El color no es el dato: quien no distingue verde de rojo tiene que poder
    // leer si subió o bajó.
    const r = armarReporte(fila(), ["cumplimiento"], PERIODO);
    expect(r.filas[0]?.variacion).toBe("+4 (sube)");
  });

  it("una bajada se dice bajada", () => {
    const r = armarReporte(fila(), ["quiebres"], PERIODO);
    expect(r.filas[0]?.variacion).toBe("-5 (baja)");
  });

  it("sin cambio lo dice con palabras", () => {
    const r = armarReporte(fila(), ["diferencias"], PERIODO);
    expect(r.filas[0]?.variacion).toBe("Sin cambio");
  });

  it("sin periodo anterior comparable lo dice, no finge un cero", () => {
    const r = armarReporte(
      fila({ cumplimiento_pct_prev: null }),
      ["cumplimiento"],
      PERIODO,
    );
    expect(r.filas[0]?.variacion).toBe("Sin comparación");
  });

  it("un valor nulo sale como «—», sin excepción", () => {
    const r = armarReporte(
      fila({ cumplimiento_pct: null }),
      ["cumplimiento"],
      PERIODO,
    );
    expect(r.filas[0]?.valor).toBe("—");
  });
});

describe("filasDelReporte", () => {
  it("cabecera más una fila por indicador", () => {
    const filas = filasDelReporte(armarReporte(fila(), ["sos"], PERIODO));

    expect(filas[0]).toEqual(["Indicador", "Valor", "Variación"]);
    expect(filas).toHaveLength(2);
    expect(filas[1]).toEqual(["Share of Shelf", "38%", "+2 (sube)"]);
  });
});

describe("nombreDeArchivo", () => {
  it("lleva las dos fechas y termina en .xlsx", () => {
    expect(nombreDeArchivo(PERIODO)).toBe(
      "reporte-market-track-2026-08-01-2026-08-26.xlsx",
    );
  });

  it("NO contiene texto de la base de datos", () => {
    // Va a una cabecera `Content-Disposition`: una comilla o un salto de línea
    // dentro del nombre del cliente sería inyección de cabecera.
    expect(nombreDeArchivo(PERIODO)).toMatch(/^[a-z0-9-]+\.xlsx$/);
  });
});

describe("serializarReporte", () => {
  it("conserva los filtros globales y añade un kpi por indicador", () => {
    const qs = serializarReporte(
      { desde: "2026-08-01", hasta: "2026-08-26", cadena: null, tienda: null },
      ["sos", "precio"],
    );

    expect(qs).toContain("desde=2026-08-01");
    expect(qs).toContain("hasta=2026-08-26");
    expect(qs).toContain("kpi=sos");
    expect(qs).toContain("kpi=precio");
  });

  it("sin selección no añade ningún kpi", () => {
    const qs = serializarReporte({ desde: "2026-08-01" }, null);
    expect(qs).toBe("?desde=2026-08-01");
  });
});

describe("reporteQuerySchema", () => {
  const base = {
    desde: "2026-08-01",
    hasta: "2026-08-26",
    cadena: null,
    tienda: null,
    kpi: null,
  };

  it("acepta un rango válido", () => {
    expect(reporteQuerySchema.safeParse(base).success).toBe(true);
  });

  it("rechaza el rango INVERTIDO", () => {
    // Hoy eso solo ensucia el dashboard; en el reporte produciría un Excel
    // vacío con una cabecera que anuncia un periodo imposible.
    const r = reporteQuerySchema.safeParse({
      ...base,
      desde: "2026-08-26",
      hasta: "2026-08-01",
    });
    expect(r.success).toBe(false);
  });

  it("rechaza un rango de años", () => {
    const r = reporteQuerySchema.safeParse({
      ...base,
      desde: "2020-01-01",
      hasta: "2026-08-26",
    });
    expect(r.success).toBe(false);
  });

  it("exige las dos fechas: no inventa un periodo que el usuario no vio", () => {
    expect(
      reporteQuerySchema.safeParse({ ...base, desde: undefined }).success,
    ).toBe(false);
  });

  it("rechaza una cadena que no es un id", () => {
    expect(
      reporteQuerySchema.safeParse({ ...base, cadena: "; drop table" }).success,
    ).toBe(false);
  });

  it("rechaza una selección de KPI vacía", () => {
    expect(reporteQuerySchema.safeParse({ ...base, kpi: [] }).success).toBe(
      false,
    );
  });

  it("rechaza un KPI que no existe", () => {
    expect(
      reporteQuerySchema.safeParse({ ...base, kpi: ["inventado"] }).success,
    ).toBe(false);
  });
});
