import { describe, expect, it } from "@jest/globals";

import { detalleCuadra, shareEnVivo, sumaCompetencia } from "./share-of-shelf";

describe("sumaCompetencia", () => {
  it("suma los frentes de todos los competidores", () => {
    expect(
      sumaCompetencia([
        { competidor: "Frutísima", frentes: 3 },
        { competidor: "Selva Viva", frentes: 2 },
      ]),
    ).toBe(5);
  });

  it("es 0 sin competidores", () => {
    expect(sumaCompetencia([])).toBe(0);
  });

  it("ignora conteos negativos", () => {
    expect(sumaCompetencia([{ competidor: "X", frentes: -4 }])).toBe(0);
  });
});

describe("shareEnVivo", () => {
  it("calcula el porcentaje propio del total", () => {
    expect(shareEnVivo(6, 4)).toBe(60);
  });

  it("es 0 cuando no hay frentes contados", () => {
    expect(shareEnVivo(0, 0)).toBe(0);
  });

  it("es 100 cuando no hay competencia", () => {
    expect(shareEnVivo(5, 0)).toBe(100);
  });

  it("redondea al entero más cercano", () => {
    expect(shareEnVivo(1, 2)).toBe(33);
  });
});

describe("detalleCuadra", () => {
  it("cuadra cuando la suma del detalle iguala el agregado", () => {
    expect(detalleCuadra(10, 10)).toBe(true);
  });

  it("no cuadra cuando difieren", () => {
    expect(detalleCuadra(10, 8)).toBe(false);
  });
});
