import { describe, expect, it, jest } from "@jest/globals";

// SecureStore no existe fuera del dispositivo: se moquea para probar la lógica
// pura (ventana) sin el módulo nativo.
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import { calcularVentana, dispositivoVigente } from "./recordar-dispositivo";

const AHORA = Date.UTC(2026, 6, 17, 12, 0, 0);
const DIA = 24 * 60 * 60 * 1000;

describe("calcularVentana", () => {
  it("recordar suma 30 días", () => {
    expect(calcularVentana(AHORA, true)).toBe(AHORA + 30 * DIA);
  });

  it("no recordar no extiende: la ventana vence ya", () => {
    // Sin recordar, el próximo arranque en frío vuelve a pedir el 2FA.
    expect(calcularVentana(AHORA, false)).toBe(AHORA);
  });
});

describe("dispositivoVigente", () => {
  it("dentro de la ventana, sigue vigente", () => {
    expect(dispositivoVigente(AHORA + 30 * DIA, AHORA + 10 * DIA)).toBe(true);
  });

  it("justo en el límite ya no vale (estricto)", () => {
    expect(dispositivoVigente(AHORA, AHORA)).toBe(false);
  });

  it("pasada la ventana, caduca — toca 2FA de nuevo", () => {
    expect(dispositivoVigente(AHORA, AHORA + 1)).toBe(false);
  });

  it("sin marca guardada, nunca está vigente", () => {
    expect(dispositivoVigente(null, AHORA)).toBe(false);
  });
});
