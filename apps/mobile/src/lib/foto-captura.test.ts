import { describe, expect, it, jest } from "@jest/globals";

// foto-captura.ts importa módulos nativos (image-manipulator, crypto, file-system)
// solo usados por procesarFoto. Se moquean para poder probar lineasWatermark (pura).
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: "jpeg" },
}));
jest.mock("expo-crypto", () => ({
  digestStringAsync: jest.fn(),
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
}));
jest.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: jest.fn(),
  EncodingType: { Base64: "base64" },
}));

import { lineasWatermark } from "./foto-captura";

describe("lineasWatermark", () => {
  const base = {
    capturado_at: "2026-07-22T14:05:00.000Z",
    lat: -12.0776,
    lng: -77.0904,
    usuario: "jose.quispe@markettrack.pe",
  };

  it("tres líneas: coordenadas, fecha/hora y usuario", () => {
    const l = lineasWatermark(base);
    expect(l).toHaveLength(3);
  });

  it("la primera línea son las coordenadas a 6 decimales", () => {
    expect(lineasWatermark(base)[0]).toBe("-12.077600, -77.090400");
  });

  it("la última línea es el usuario", () => {
    expect(lineasWatermark(base)[2]).toBe("jose.quispe@markettrack.pe");
  });

  it("la fecha va como dd/mm/aaaa hh:mm (hora local)", () => {
    expect(lineasWatermark(base)[1]).toMatch(
      /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/,
    );
  });
});
