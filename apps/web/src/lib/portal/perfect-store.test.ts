import { describe, expect, it } from "vitest";

import {
  armarVariables,
  barrasDeSerie,
  type FilaAgregado,
  hrefDelGrupo,
  leerFiltrosPerfectStore,
  migasDelDrilldown,
  nivelDelDrilldown,
} from "./perfect-store";

const AGREGADO: FilaAgregado = {
  levantamientos: 12,
  total_pct: 78.5,
  distribucion_pct: 90,
  visibilidad_pct: 60,
  precio_pct: 85,
};

describe("leerFiltrosPerfectStore", () => {
  it("descarta una categoría que no tiene forma de uuid", () => {
    expect(leerFiltrosPerfectStore({ categoria: "'; drop--" }).categoria).toBe(
      null,
    );
  });

  it("descarta un tipo de tienda que no está en el enum", () => {
    expect(
      leerFiltrosPerfectStore({ tipotienda: "mayorista" }).tipoTienda,
    ).toBe(null);
  });

  it("la granularidad por defecto es la semana", () => {
    expect(leerFiltrosPerfectStore({}).granularidad).toBe("semana");
    expect(leerFiltrosPerfectStore({ granularidad: "año" }).granularidad).toBe(
      "semana",
    );
  });

  it("lee los valores válidos tal cual", () => {
    const f = leerFiltrosPerfectStore({
      categoria: "a0000004-0000-0000-0000-000000000001",
      tipotienda: "hiper",
      granularidad: "mes",
    });
    expect(f).toEqual({
      categoria: "a0000004-0000-0000-0000-000000000001",
      tipoTienda: "hiper",
      granularidad: "mes",
    });
  });
});

describe("nivelDelDrilldown", () => {
  const vacia = {
    categoria: null,
    tipoTienda: null,
    cadena: null,
    tienda: null,
  };

  it("sin nada filtrado se desglosa por categoría", () => {
    expect(nivelDelDrilldown(vacia)).toBe("categoria");
  });

  it("cada filtro puesto baja un nivel", () => {
    expect(nivelDelDrilldown({ ...vacia, categoria: "c" })).toBe("tipo_tienda");
    expect(nivelDelDrilldown({ ...vacia, tipoTienda: "hiper" })).toBe("cadena");
    expect(nivelDelDrilldown({ ...vacia, cadena: "x" })).toBe("tienda");
  });

  it("con una tienda elegida ya no hay nivel más hondo", () => {
    expect(nivelDelDrilldown({ ...vacia, cadena: "x", tienda: "t" })).toBe(
      null,
    );
  });

  it("el filtro más hondo manda aunque falten los de arriba", () => {
    // Pasa con un enlace que trae solo la tienda: el nivel se deduce del estado
    // real, no de que se haya recorrido el camino entero.
    expect(nivelDelDrilldown({ ...vacia, categoria: "c", tienda: "t" })).toBe(
      null,
    );
  });
});

describe("hrefDelGrupo", () => {
  it("añade la clave del nivel conservando el resto de la URL", () => {
    const href = hrefDelGrupo("cadena", "cad-1", {
      desde: "2026-08-01",
      categoria: "cat-1",
    });
    expect(href).toContain("desde=2026-08-01");
    expect(href).toContain("categoria=cat-1");
    expect(href).toContain("cadena=cad-1");
  });

  it("el tipo de tienda viaja como `tipotienda`, no como `tipo`", () => {
    // `tipo` ya significa otra cosa en la galería y en las alertas, y los filtros
    // se arrastran entre secciones de la misma URL.
    expect(hrefDelGrupo("tipo_tienda", "hiper", {})).toContain(
      "tipotienda=hiper",
    );
  });
});

describe("migasDelDrilldown", () => {
  it("sin filtros solo está la raíz", () => {
    const migas = migasDelDrilldown(
      { categoria: null, tipoTienda: null, cadena: null, tienda: null },
      {},
      {},
    );
    expect(migas).toEqual([
      { etiqueta: "Todo", href: "/cliente/perfect-store" },
    ]);
  });

  it("cada miga QUITA su nivel y los de abajo", () => {
    const params = {
      categoria: "cat-1",
      tipotienda: "hiper",
      cadena: "cad-1",
      desde: "2026-08-01",
    };
    const migas = migasDelDrilldown(
      {
        categoria: "cat-1",
        tipoTienda: "hiper",
        cadena: "cad-1",
        tienda: null,
      },
      { categoria: "Bebidas", cadena: "Plaza Vea" },
      params,
    );

    expect(migas.map((m) => m.etiqueta)).toEqual([
      "Todo",
      "Bebidas",
      "hiper",
      "Plaza Vea",
    ]);
    // Volver a "Bebidas" suelta el tipo de tienda y la cadena…
    expect(migas[1]?.href).toContain("categoria=cat-1");
    expect(migas[1]?.href).not.toContain("tipotienda");
    expect(migas[1]?.href).not.toContain("cadena");
    // …y "Todo" no conserva ningún nivel, pero sí el periodo filtrado.
    expect(migas[0]?.href).toContain("desde=2026-08-01");
    expect(migas[0]?.href).not.toContain("categoria");
  });
});

describe("armarVariables", () => {
  it("POP y Orden se leen como no evaluadas, no como cero", () => {
    // Un cero convertiría una variable que nadie mide en una tienda que falló.
    const kpis = armarVariables(AGREGADO, null);
    const pop = kpis.find((k) => k.clave === "pop");
    const orden = kpis.find((k) => k.clave === "orden");
    expect(pop?.valor).toBe("No evaluada");
    expect(orden?.valor).toBe("No evaluada");
  });

  it("sin datos ninguna variable muestra un número", () => {
    const kpis = armarVariables(null, null);
    expect(kpis.filter((k) => k.valor === "—")).toHaveLength(4);
  });

  it("una variable nula del periodo sale como sin dato, no como 0 %", () => {
    const kpis = armarVariables({ ...AGREGADO, visibilidad_pct: null }, null);
    expect(kpis.find((k) => k.clave === "visibilidad")?.valor).toBe("—");
  });

  it("compara contra el periodo anterior cuando lo hay", () => {
    const kpis = armarVariables(AGREGADO, { ...AGREGADO, total_pct: 70 });
    expect(kpis[0]?.tendencia).toEqual({
      disponible: true,
      delta: 8.5,
      direccion: "sube",
    });
  });

  it("sin periodo anterior no se inventa una comparación", () => {
    const kpis = armarVariables(AGREGADO, null);
    expect(kpis[0]?.tendencia).toEqual({ disponible: false });
  });
});

describe("barrasDeSerie", () => {
  it("un bucket sin puntaje conserva su sitio con altura cero", () => {
    const barras = barrasDeSerie(
      [
        { periodo: "2026-08-03", levantamientos: 2, total_pct: 50 },
        { periodo: "2026-08-10", levantamientos: 0, total_pct: null },
      ],
      "semana",
    );
    expect(barras).toHaveLength(2);
    expect(barras[1]?.valor).toBe(null);
    expect(barras[1]?.altura).toBe(0);
  });

  it("la escala es de 0 a 100, no al máximo observado", () => {
    // Reescalar al máximo haría que un 40 % pareciese lleno.
    const barras = barrasDeSerie(
      [
        { periodo: "2026-08-03", levantamientos: 1, total_pct: 40 },
        { periodo: "2026-08-10", levantamientos: 1, total_pct: 20 },
      ],
      "semana",
    );
    expect(barras[0]?.altura).toBeCloseTo(0.4);
    expect(barras[1]?.altura).toBeCloseTo(0.2);
  });

  it("la etiqueta mensual dice el mes, no el día", () => {
    const [barra] = barrasDeSerie(
      [{ periodo: "2026-08-01", levantamientos: 1, total_pct: 50 }],
      "mes",
    );
    expect(barra?.etiqueta).toMatch(/2026/);
    expect(barra?.etiqueta).not.toMatch(/01/);
  });
});
