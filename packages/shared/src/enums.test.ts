import { Constants } from "@market-track/db";
import { describe, expect, it } from "vitest";

import {
  moduloPortalSchema,
  pasoLevantamientoSchema,
  rolUsuarioSchema,
  tipoFotoSchema,
} from "./enums";

describe("enums derivados de la base", () => {
  it("acepta los valores que la base considera válidos", () => {
    expect(rolUsuarioSchema.parse("mercaderista")).toBe("mercaderista");
    expect(tipoFotoSchema.parse("contingencia")).toBe("contingencia");
    expect(pasoLevantamientoSchema.parse("share_of_shelf")).toBe(
      "share_of_shelf",
    );
    expect(moduloPortalSchema.parse("galeria")).toBe("galeria");
  });

  it("rechaza un valor que la base no reconoce", () => {
    expect(rolUsuarioSchema.safeParse("auditor").success).toBe(false);
    expect(tipoFotoSchema.safeParse("selfie_grupal").success).toBe(false);
    expect(moduloPortalSchema.safeParse("facturacion").success).toBe(false);
  });

  it("no duplica la lista: el esquema y la base son literalmente el mismo array", () => {
    // Si alguien reescribiera el enum a mano, este test lo cazaría: la lista de
    // Zod dejaría de coincidir con la que emite el generador de tipos.
    expect(rolUsuarioSchema.options).toEqual([
      ...Constants.public.Enums.rol_usuario,
    ]);
    expect(tipoFotoSchema.options).toEqual([
      ...Constants.public.Enums.tipo_foto,
    ]);
    expect(moduloPortalSchema.options).toEqual([
      ...Constants.public.Enums.modulo_portal,
    ]);
  });
});
