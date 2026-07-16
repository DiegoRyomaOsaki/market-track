import { describe, expect, it } from "vitest";

import {
  assertSinSecretosExpuestos,
  parseEnvPublico,
  parseEnvServidor,
} from "./env";

const SERVIDOR_OK = {
  SUPABASE_URL: "https://xyz.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "sk_secreta",
  R2_ACCOUNT_ID: "acc",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "fotos",
  RESEND_API_KEY: "re_123",
};

describe("assertSinSecretosExpuestos — el guardarraíl que da sentido al módulo", () => {
  it("lanza si la service_role key lleva prefijo público de Next", () => {
    expect(() =>
      assertSinSecretosExpuestos({
        NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "sk_ups",
      }),
    ).toThrow(/salta RLS/);
  });

  it("lanza si lleva prefijo público de Expo", () => {
    expect(() =>
      assertSinSecretosExpuestos({
        EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "sk_ups",
      }),
    ).toThrow(/bundle del cliente/);
  });

  it("caza también las credenciales de R2 y de Resend", () => {
    expect(() =>
      assertSinSecretosExpuestos({ NEXT_PUBLIC_R2_SECRET_ACCESS_KEY: "x" }),
    ).toThrow();
    expect(() =>
      assertSinSecretosExpuestos({ EXPO_PUBLIC_RESEND_API_KEY: "x" }),
    ).toThrow();
  });

  it("caza el secreto aunque venga con adornos alrededor", () => {
    expect(() =>
      assertSinSecretosExpuestos({
        NEXT_PUBLIC_MI_SUPABASE_SERVICE_ROLE_KEY_TEMP: "x",
      }),
    ).toThrow();
  });

  it("NO lanza con lo que sí es público: la anon key la contiene RLS", () => {
    expect(() =>
      assertSinSecretosExpuestos({
        NEXT_PUBLIC_SUPABASE_URL: "https://xyz.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
        EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon",
      }),
    ).not.toThrow();
  });

  it("NO lanza con un secreto de servidor SIN prefijo público: ahí es donde debe estar", () => {
    expect(() =>
      assertSinSecretosExpuestos({ SUPABASE_SERVICE_ROLE_KEY: "sk" }),
    ).not.toThrow();
  });
});

describe("parseEnvServidor", () => {
  it("acepta un entorno completo", () => {
    expect(parseEnvServidor(SERVIDOR_OK).R2_BUCKET).toBe("fotos");
  });

  it("ROMPE EL ARRANQUE si falta un secreto, y dice cuál", () => {
    const { RESEND_API_KEY: _omitida, ...incompleto } = SERVIDOR_OK;
    expect(() => parseEnvServidor(incompleto)).toThrow(/RESEND_API_KEY/);
  });

  it("no inventa un valor por defecto: un fallback en producción es un bypass silencioso", () => {
    const { SUPABASE_SERVICE_ROLE_KEY: _omitida, ...sinClave } = SERVIDOR_OK;
    expect(() => parseEnvServidor(sinClave)).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("rechaza una URL que no lo es", () => {
    expect(() =>
      parseEnvServidor({ ...SERVIDOR_OK, SUPABASE_URL: "no-soy-una-url" }),
    ).toThrow(/SUPABASE_URL/);
  });
});

describe("parseEnvPublico", () => {
  it("acepta lo mínimo que el cliente necesita", () => {
    expect(
      parseEnvPublico({
        SUPABASE_URL: "https://xyz.supabase.co",
        SUPABASE_ANON_KEY: "anon",
      }).SUPABASE_ANON_KEY,
    ).toBe("anon");
  });

  it("acepta la URL de tiles como ruta del sitio o como URL de R2", () => {
    const base = {
      SUPABASE_URL: "https://xyz.supabase.co",
      SUPABASE_ANON_KEY: "anon",
    };
    expect(
      parseEnvPublico({ ...base, TILES_URL: "/tiles/lima.pmtiles" }).TILES_URL,
    ).toBe("/tiles/lima.pmtiles");
    expect(
      parseEnvPublico({
        ...base,
        TILES_URL: "https://r2.example.com/peru.pmtiles",
      }).TILES_URL,
    ).toBe("https://r2.example.com/peru.pmtiles");
  });

  it("no acepta como 'ruta' una protocolo-relativa a otro dominio", () => {
    // `//otro.com/x.pmtiles` empieza por barra y parece interna: el navegador la
    // resuelve a https://otro.com. El mapa base saldría de un tercero.
    expect(() =>
      parseEnvPublico({
        SUPABASE_URL: "https://xyz.supabase.co",
        SUPABASE_ANON_KEY: "anon",
        TILES_URL: "//otro.com/tiles.pmtiles",
      }),
    ).toThrow();
  });

  it("sin TILES_URL sigue valiendo: el móvil no lleva mapa (ADR-0009)", () => {
    expect(
      parseEnvPublico({
        SUPABASE_URL: "https://xyz.supabase.co",
        SUPABASE_ANON_KEY: "anon",
      }).TILES_URL,
    ).toBeUndefined();
  });

  it("también corre el guardarraíl: no deja pasar un secreto expuesto", () => {
    expect(() =>
      parseEnvPublico({
        SUPABASE_URL: "https://xyz.supabase.co",
        SUPABASE_ANON_KEY: "anon",
        NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "sk_ups",
      }),
    ).toThrow(/salta RLS/);
  });
});
