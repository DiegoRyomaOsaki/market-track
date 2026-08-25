import { describe, expect, it } from "vitest";

import { diaEnLima } from "./fecha-lima";

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
