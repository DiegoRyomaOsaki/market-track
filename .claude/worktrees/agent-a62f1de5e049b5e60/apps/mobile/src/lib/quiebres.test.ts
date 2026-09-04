import { describe, expect, it } from "@jest/globals";

import { deltaDiferencia, esDiferencia, esQuiebre } from "./quiebres";

describe("esQuiebre", () => {
  it("es quiebre con sistema > 0 y piso 0", () => {
    expect(esQuiebre(5, 0)).toBe(true);
  });

  it("no es quiebre si hay stock en piso", () => {
    expect(esQuiebre(5, 2)).toBe(false);
  });

  it("no es quiebre si el sistema también está en 0", () => {
    expect(esQuiebre(0, 0)).toBe(false);
  });
});

describe("esDiferencia", () => {
  it("es diferencia con piso > 0 y piso ≠ sistema", () => {
    expect(esDiferencia(5, 3)).toBe(true);
  });

  it("no es diferencia cuando piso iguala al sistema", () => {
    expect(esDiferencia(5, 5)).toBe(false);
  });

  it("no es diferencia con piso 0 (eso es quiebre)", () => {
    expect(esDiferencia(5, 0)).toBe(false);
  });
});

describe("quiebre y diferencia son excluyentes", () => {
  it("nunca son ambos verdaderos", () => {
    for (const sistema of [0, 1, 5]) {
      for (const piso of [0, 1, 5]) {
        expect(esQuiebre(sistema, piso) && esDiferencia(sistema, piso)).toBe(
          false,
        );
      }
    }
  });
});

describe("deltaDiferencia", () => {
  it("es piso menos sistema", () => {
    expect(deltaDiferencia(5, 3)).toBe(-2);
    expect(deltaDiferencia(3, 5)).toBe(2);
  });
});
