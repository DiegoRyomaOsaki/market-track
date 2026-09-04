import { describe, expect, it } from "vitest";

import { inicial, iniciales } from "./iniciales";

describe("iniciales", () => {
  it("toma dos iniciales de un nombre compuesto", () => {
    expect(iniciales("Ana María Pérez")).toBe("AM");
  });

  it("una sola palabra da una inicial", () => {
    expect(iniciales("Oster")).toBe("O");
  });

  it("nombre vacío o de solo espacios da '?'", () => {
    expect(iniciales("")).toBe("?");
    expect(iniciales("   ")).toBe("?");
  });
});

describe("inicial", () => {
  it("toma la primera letra en mayúscula", () => {
    expect(inicial("oster")).toBe("O");
    expect(inicial("  sharpie")).toBe("S");
  });

  it("vacío da '?'", () => {
    expect(inicial("")).toBe("?");
    expect(inicial("   ")).toBe("?");
  });
});
