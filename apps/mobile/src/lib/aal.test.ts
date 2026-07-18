import { describe, expect, it } from "@jest/globals";

import { aalDeToken, esAal2 } from "./aal";

// JWT de juguete (firma falsa): solo se lee el payload, no se verifica la firma.
const AAL1 =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1IiwiYWFsIjoiYWFsMSJ9.firma";
const AAL2 =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1IiwiYWFsIjoiYWFsMiJ9.firma";
const SIN_AAL = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1In0.firma";

describe("aalDeToken", () => {
  it("lee aal1 y aal2 del claim", () => {
    expect(aalDeToken(AAL1)).toBe("aal1");
    expect(aalDeToken(AAL2)).toBe("aal2");
  });

  it("sin claim aal, devuelve null", () => {
    expect(aalDeToken(SIN_AAL)).toBeNull();
  });

  it("con token ausente o basura, devuelve null en vez de reventar", () => {
    expect(aalDeToken(undefined)).toBeNull();
    expect(aalDeToken(null)).toBeNull();
    expect(aalDeToken("")).toBeNull();
    expect(aalDeToken("no-es-un-jwt")).toBeNull();
    expect(aalDeToken("a.b")).toBeNull();
  });
});

describe("esAal2", () => {
  it("solo aal2 entra a la app", () => {
    // El bug que cazó el emulador: una sesión aal1 (solo contraseña) NO puede
    // pasar del login. El guard del layout se apoya en esto.
    expect(esAal2(AAL2)).toBe(true);
    expect(esAal2(AAL1)).toBe(false);
    expect(esAal2(SIN_AAL)).toBe(false);
    expect(esAal2(undefined)).toBe(false);
  });
});
