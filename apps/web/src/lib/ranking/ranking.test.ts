import { describe, expect, it } from "vitest";

import {
  esFechaISO,
  etiquetaDePeriodo,
  formatearDelta,
  formatearDeltaPosicion,
  inicioDePeriodo,
  periodoAnterior,
  periodoSiguiente,
  textoDePosicion,
} from "./ranking";

// La regla del proyecto: una función que ramifica sobre un enum se prueba con
// TODOS sus valores. Un inicio de periodo mal resuelto para un tipo se nota
// meses después, al cierre — cuando ya salió un bono de él.

describe("inicioDePeriodo", () => {
  it("mensual: el día 1 del mes", () => {
    expect(inicioDePeriodo("mensual", "2026-08-21")).toBe("2026-08-01");
  });

  it("trimestral: el día 1 del trimestre, en los tres meses del trimestre", () => {
    expect(inicioDePeriodo("trimestral", "2026-07-01")).toBe("2026-07-01");
    expect(inicioDePeriodo("trimestral", "2026-08-21")).toBe("2026-07-01");
    expect(inicioDePeriodo("trimestral", "2026-09-30")).toBe("2026-07-01");
    expect(inicioDePeriodo("trimestral", "2026-10-01")).toBe("2026-10-01");
  });

  it("anual: el 1 de enero", () => {
    expect(inicioDePeriodo("anual", "2026-08-21")).toBe("2026-01-01");
  });
});

describe("periodoAnterior / periodoSiguiente", () => {
  it("mensual cruza el año hacia atrás", () => {
    expect(periodoAnterior("mensual", "2026-01-01")).toBe("2025-12-01");
  });

  it("trimestral retrocede tres meses", () => {
    expect(periodoAnterior("trimestral", "2026-07-01")).toBe("2026-04-01");
  });

  it("anual retrocede un año", () => {
    expect(periodoAnterior("anual", "2026-01-01")).toBe("2025-01-01");
  });

  it("siguiente y anterior son inversos para los tres tipos", () => {
    for (const tipo of ["mensual", "trimestral", "anual"] as const) {
      expect(periodoAnterior(tipo, periodoSiguiente(tipo, "2026-07-01"))).toBe(
        "2026-07-01",
      );
    }
  });
});

describe("etiquetaDePeriodo", () => {
  it("nombra cada tipo a su manera", () => {
    expect(etiquetaDePeriodo("mensual", "2026-07-01")).toBe("Julio 2026");
    expect(etiquetaDePeriodo("trimestral", "2026-07-01")).toBe("T3 2026");
    expect(etiquetaDePeriodo("anual", "2026-01-01")).toBe("2026");
  });
});

describe("formatearDelta", () => {
  it("sin uno de los dos lados es «—», nunca 0", () => {
    // Un 0 diría «igual que antes»; sin periodo anterior no hay «antes».
    expect(formatearDelta(80, null)).toBe("—");
    expect(formatearDelta(null, 80)).toBe("—");
  });

  it("sube con signo, baja con signo, igual es «=»", () => {
    expect(formatearDelta(84.5, 80)).toBe("+4.5");
    expect(formatearDelta(75.5, 80)).toBe("−4.5");
    expect(formatearDelta(80, 80)).toBe("=");
  });
});

describe("formatearDeltaPosicion", () => {
  it("subir puestos es positivo: la posición BAJA de número", () => {
    expect(formatearDeltaPosicion(2, 5)).toBe("▲ 3");
    expect(formatearDeltaPosicion(5, 2)).toBe("▼ 3");
    expect(formatearDeltaPosicion(3, 3)).toBe("=");
  });

  it("sin posición en uno de los lados es «—»", () => {
    expect(formatearDeltaPosicion(null, 2)).toBe("—");
    expect(formatearDeltaPosicion(2, null)).toBe("—");
  });
});

describe("textoDePosicion", () => {
  it("marca el empate: dos «2.º» sin etiqueta se leen como bug", () => {
    expect(textoDePosicion(2, true)).toBe("2.º (empate)");
    expect(textoDePosicion(1, false)).toBe("1.º");
  });

  it("sin posición es «Sin datos», que no es un puesto", () => {
    expect(textoDePosicion(null, false)).toBe("Sin datos");
  });
});

describe("esFechaISO", () => {
  it("acepta una fecha real y rechaza el resto", () => {
    expect(esFechaISO("2026-07-01")).toBe(true);
    expect(esFechaISO("2026-13-01")).toBe(false);
    expect(esFechaISO("basura")).toBe(false);
    expect(esFechaISO("2026-07-01T00:00:00Z")).toBe(false);
  });
});
