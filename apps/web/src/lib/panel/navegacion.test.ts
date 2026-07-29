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
    // El constructor de formularios: la lista, el alta y el detalle caen todos
    // en la misma sección (y su ayuda contextual).
    expect(itemActivo("/admin/formularios")?.label).toBe("Formularios");
    expect(itemActivo("/admin/formularios/nuevo")?.href).toBe(
      "/admin/formularios",
    );
    expect(itemActivo("/admin/formularios/abc-123")?.href).toBe(
      "/admin/formularios",
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

  it("todo item de NAV tiene título y ayuda contextual", () => {
    // Ninguna sección puede quedarse sin su texto de ayuda (`?`): el popover lo
    // lee de aquí, que es la fuente única.
    for (const item of NAV) {
      expect(item.titulo.length).toBeGreaterThan(0);
      expect(item.ayuda.length).toBeGreaterThan(20);
    }
  });
});
