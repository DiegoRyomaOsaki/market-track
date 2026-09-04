import { describe, expect, it } from "vitest";

import { diaEnLima, diasDelRango, diasEntre, sumarDias } from "./fecha-lima";

describe("diaEnLima", () => {
  it("a las 20:00 de Lima sigue siendo el mismo día, aunque en UTC ya sea el siguiente", () => {
    // La pitfall entera del proyecto en un test: 2026-08-04T01:00Z son las 20:00
    // del 3 de agosto en Lima. `toISOString().slice(0,10)` diría "2026-08-04" y se
    // comería el turno de cierre de tienda.
    const instante = new Date("2026-08-04T01:00:00Z");
    expect(instante.toISOString().slice(0, 10)).toBe("2026-08-04");
    expect(diaEnLima(instante)).toBe("2026-08-03");
  });

  it("a las 00:30 de Lima ya es el día nuevo", () => {
    expect(diaEnLima(new Date("2026-08-04T05:30:00Z"))).toBe("2026-08-04");
  });

  it("justo a medianoche de Lima cambia el día", () => {
    expect(diaEnLima(new Date("2026-08-04T04:59:59Z"))).toBe("2026-08-03");
    expect(diaEnLima(new Date("2026-08-04T05:00:00Z"))).toBe("2026-08-04");
  });

  it("devuelve siempre YYYY-MM-DD con ceros a la izquierda", () => {
    expect(diaEnLima(new Date("2026-01-05T15:00:00Z"))).toBe("2026-01-05");
  });
});

describe("sumarDias", () => {
  it("suma dentro del mes", () => {
    expect(sumarDias("2026-08-03", 4)).toBe("2026-08-07");
  });

  it("resta cruzando al mes anterior", () => {
    expect(sumarDias("2026-08-01", -1)).toBe("2026-07-31");
  });

  it("cruza el cambio de año", () => {
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("resuelve el 29 de febrero de un bisiesto", () => {
    expect(sumarDias("2028-02-28", 1)).toBe("2028-02-29");
    expect(sumarDias("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("sumar cero devuelve el mismo día", () => {
    expect(sumarDias("2026-08-03", 0)).toBe("2026-08-03");
  });
});

describe("diasEntre", () => {
  it("cuenta la diferencia en días", () => {
    expect(diasEntre("2026-08-03", "2026-08-09")).toBe(6);
  });

  it("es negativa si el segundo es anterior", () => {
    expect(diasEntre("2026-08-09", "2026-08-03")).toBe(-6);
  });

  it("el mismo día son cero días", () => {
    expect(diasEntre("2026-08-03", "2026-08-03")).toBe(0);
  });

  it("cuenta bien a través de un mes de 31 y de febrero", () => {
    expect(diasEntre("2026-01-01", "2026-02-01")).toBe(31);
    expect(diasEntre("2026-02-01", "2026-03-01")).toBe(28);
  });
});

describe("diasDelRango", () => {
  it("incluye los dos extremos", () => {
    expect(diasDelRango("2026-08-03", "2026-08-05")).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
    ]);
  });

  it("un rango de un solo día devuelve ese día", () => {
    expect(diasDelRango("2026-08-03", "2026-08-03")).toEqual(["2026-08-03"]);
  });

  it("un rango invertido devuelve vacío en vez de un array infinito", () => {
    expect(diasDelRango("2026-08-09", "2026-08-03")).toEqual([]);
  });

  it("una semana son siete días", () => {
    expect(diasDelRango("2026-08-03", "2026-08-09")).toHaveLength(7);
  });
});
