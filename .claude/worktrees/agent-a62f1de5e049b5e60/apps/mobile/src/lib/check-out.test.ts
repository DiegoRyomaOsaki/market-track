import { describe, expect, it } from "@jest/globals";

import { visitaListaParaCheckOut } from "./check-out";
import { minutosDeTraslado } from "./transito";

describe("visitaListaParaCheckOut", () => {
  it("está lista si toda marca quedó completada u omitida", () => {
    expect(visitaListaParaCheckOut(["completado", "omitido"])).toBe(true);
  });

  it("no está lista si una marca sigue en curso", () => {
    expect(visitaListaParaCheckOut(["completado", "en_curso"])).toBe(false);
  });

  it("no está lista si una marca sigue pendiente (null)", () => {
    expect(visitaListaParaCheckOut(["completado", null])).toBe(false);
  });

  it("no está lista sin marcas", () => {
    expect(visitaListaParaCheckOut([])).toBe(false);
  });
});

describe("minutosDeTraslado", () => {
  it("redondea los minutos entre dos instantes", () => {
    expect(
      minutosDeTraslado("2026-07-27T10:00:00.000Z", "2026-07-27T10:12:30.000Z"),
    ).toBe(13);
  });

  it("nunca es negativo si los relojes se desordenan", () => {
    expect(
      minutosDeTraslado("2026-07-27T10:12:00.000Z", "2026-07-27T10:00:00.000Z"),
    ).toBe(0);
  });
});
