import { moduloPortalSchema } from "@market-track/shared";
import { describe, expect, it } from "vitest";

import { ETIQUETA_MODULO, estadoDeModulos } from "./modulos";

describe("estadoDeModulos", () => {
  it("todos habilitados por defecto cuando no hay overrides", () => {
    const estado = estadoDeModulos([]);
    expect(Object.values(estado).every(Boolean)).toBe(true);
    expect(Object.keys(estado)).toHaveLength(moduloPortalSchema.options.length);
  });

  it("respeta un override que deshabilita, y el resto queda en true", () => {
    const estado = estadoDeModulos([{ modulo: "reportes", habilitado: false }]);
    expect(estado.reportes).toBe(false);
    expect(estado.dashboard).toBe(true);
  });

  it("ignora un módulo que ya no existe en el enum", () => {
    const estado = estadoDeModulos([
      { modulo: "facturacion", habilitado: false },
    ]);
    expect(Object.values(estado).every(Boolean)).toBe(true);
  });

  it("todos deshabilitados cuando cada módulo tiene un override en false", () => {
    const overrides = moduloPortalSchema.options.map((modulo) => ({
      modulo,
      habilitado: false,
    }));
    const estado = estadoDeModulos(overrides);
    expect(Object.values(estado).some(Boolean)).toBe(false);
  });
});

describe("ETIQUETA_MODULO", () => {
  it("nombra todos los módulos del enum", () => {
    for (const modulo of moduloPortalSchema.options) {
      expect(ETIQUETA_MODULO[modulo].length).toBeGreaterThan(0);
    }
  });
});
