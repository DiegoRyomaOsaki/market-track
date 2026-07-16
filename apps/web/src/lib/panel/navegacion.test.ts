import { describe, expect, it } from "vitest";

import { itemActivo, NAV } from "./navegacion";

describe("itemActivo", () => {
  it("resuelve el item exacto por su href", () => {
    expect(itemActivo("/admin/catalogo")?.label).toBe("Catálogo");
    expect(itemActivo("/supervisor/ruteros")?.label).toBe("Ruteros");
  });

  it("resuelve por prefijo para subrutas (detalle de una sección)", () => {
    expect(itemActivo("/supervisor/revision/123")?.href).toBe(
      "/supervisor/revision",
    );
  });

  it("prefiere el prefijo MÁS LARGO (no confunde /admin con /admin/catalogo)", () => {
    // /admin es prefijo de /admin/catalogo; debe ganar el item más específico.
    expect(itemActivo("/admin/catalogo")?.href).toBe("/admin/catalogo");
    expect(itemActivo("/admin")?.href).toBe("/admin");
  });

  it("devuelve undefined fuera de las rutas del panel", () => {
    expect(itemActivo("/login")).toBeUndefined();
    expect(itemActivo("/cliente")).toBeUndefined();
  });

  it("todo item de NAV tiene título para el header", () => {
    for (const item of NAV) {
      expect(item.titulo.length).toBeGreaterThan(0);
    }
  });
});
