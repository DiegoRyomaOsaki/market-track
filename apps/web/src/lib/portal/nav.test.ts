import { moduloPortalSchema } from "@market-track/shared";
import { describe, expect, it } from "vitest";

import { itemPortalActivo, NAV_PORTAL } from "./nav";

describe("itemPortalActivo", () => {
  it("resuelve el dashboard en la raíz del portal", () => {
    expect(itemPortalActivo("/cliente")?.modulo).toBe("dashboard");
  });

  it("resuelve una sección por su href exacto", () => {
    expect(itemPortalActivo("/cliente/alertas")?.label).toBe("Alertas");
  });

  it("prefiere el prefijo MÁS LARGO (una subruta no cae en el dashboard)", () => {
    // "/cliente" es prefijo de "/cliente/galeria"; debe ganar la sección concreta.
    expect(itemPortalActivo("/cliente/galeria/tienda-1")?.href).toBe(
      "/cliente/galeria",
    );
  });

  it("devuelve undefined fuera del portal", () => {
    expect(itemPortalActivo("/admin")).toBeUndefined();
  });
});

describe("NAV_PORTAL", () => {
  it("cada sección tiene título, ayuda y un módulo del enum", () => {
    for (const item of NAV_PORTAL) {
      expect(item.titulo.length).toBeGreaterThan(0);
      expect(item.ayuda.length).toBeGreaterThan(20);
      expect(moduloPortalSchema.options).toContain(item.modulo);
    }
  });

  it("no repite módulos entre secciones", () => {
    const modulos = NAV_PORTAL.map((i) => i.modulo);
    expect(new Set(modulos).size).toBe(modulos.length);
  });
});
