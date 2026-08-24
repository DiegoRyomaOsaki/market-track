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
    // La sección de módulos del portal (MAR-81) resuelve su ayuda contextual.
    expect(itemActivo("/admin/portal")?.label).toBe("Portal cliente");
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

  it("la sección de métricas resuelve en las dos áreas", () => {
    // Es la misma pantalla para admin y supervisor, en dos rutas distintas: cada
    // una tiene que resolver su propio item, o el header titularía la ajena.
    expect(itemActivo("/admin/metricas")?.area).toBe("admin");
    expect(itemActivo("/supervisor/metricas")?.area).toBe("supervisor");
    // Con la pestaña en la query sigue resolviendo (el match es por prefijo).
    expect(itemActivo("/admin/metricas")?.label).toBe("Métricas y bonos");
  });

  it("el ranking resuelve en las dos áreas, también en su detalle", () => {
    expect(itemActivo("/admin/ranking")?.label).toBe("Ranking");
    expect(itemActivo("/supervisor/ranking")?.area).toBe("supervisor");
    // El detalle de un mercaderista sigue siendo la sección Ranking: el header
    // la titula y el `?` enseña su ayuda.
    expect(
      itemActivo("/supervisor/ranking/44444444-4444-4444-4444-444444444444")
        ?.href,
    ).toBe("/supervisor/ranking");
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
