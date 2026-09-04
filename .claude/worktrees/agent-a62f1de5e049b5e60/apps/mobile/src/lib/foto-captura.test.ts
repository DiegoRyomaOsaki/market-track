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

import manifest from "../../package.json";

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

describe("la captura no ofrece la galería como origen", () => {
  it("no hay ningún selector de imágenes instalado en la app", () => {
    // Decisión del cliente sobre la integridad de la evidencia: "la foto es del
    // momento, desde la cámara, no es desde la galería". El único camino de
    // captura es CamaraFoto (expo-camera). Este assert es la forma mecánica de
    // fijar esa decisión: si alguien instala un picker, este test lo delata.
    const instaladas: Record<string, string> = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
    };
    for (const picker of [
      "expo-image-picker",
      "react-native-image-picker",
      "expo-media-library",
    ]) {
      expect(instaladas).not.toHaveProperty(picker);
    }
  });
});
