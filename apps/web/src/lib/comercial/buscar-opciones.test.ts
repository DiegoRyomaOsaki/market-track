import { beforeEach, describe, expect, it, vi } from "vitest";

import { buscarSkus, buscarTiendas } from "./buscar-opciones";

// La búsqueda server-side es un endpoint POST alcanzable por cualquier sesión:
// lo que se fija aquí es su frontera — el término se escapa antes de entrar al
// patrón, la consulta SIEMPRE lleva tope, y el tenant acota cuando se pide.

const { consulta } = vi.hoisted(() => ({
  consulta: {
    data: [] as Record<string, unknown>[] | null,
    error: null as { message: string } | null,
    filtros: [] as [string, unknown][],
    tablas: [] as string[],
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => {
    const encadenable = {
      select: () => encadenable,
      eq: (columna: string, valor: unknown) => {
        consulta.filtros.push([columna, valor]);
        return encadenable;
      },
      or: (patron: string) => {
        consulta.filtros.push(["or", patron]);
        return encadenable;
      },
      ilike: (columna: string, patron: string) => {
        consulta.filtros.push([`ilike:${columna}`, patron]);
        return encadenable;
      },
      order: () => encadenable,
      limit: (n: number) => {
        consulta.filtros.push(["limit", n]);
        return Promise.resolve({ data: consulta.data, error: consulta.error });
      },
    };
    return Promise.resolve({
      from: (tabla: string) => {
        consulta.tablas.push(tabla);
        return encadenable;
      },
    });
  },
}));

const MARACUMANGO = "aaaaaaaa-0000-0000-0000-000000000001";

beforeEach(() => {
  consulta.data = [];
  consulta.error = null;
  consulta.filtros = [];
  consulta.tablas = [];
});

describe("buscarSkus", () => {
  it("un término vacío no consulta nada", async () => {
    const r = await buscarSkus("   ", MARACUMANGO);

    expect(r).toEqual({ ok: true, opciones: [] });
    expect(consulta.tablas).toHaveLength(0);
  });

  it("la consulta lleva tope SIEMPRE", async () => {
    await buscarSkus("néctar", MARACUMANGO);

    expect(consulta.filtros).toContainEqual(["limit", 20]);
    expect(consulta.filtros).toContainEqual(["activo", true]);
  });

  it("acota por el cliente que se pide", async () => {
    await buscarSkus("néctar", MARACUMANGO);

    expect(consulta.filtros).toContainEqual(["tenant_id", MARACUMANGO]);
  });

  it("escapa el término antes del patrón: una coma no parte el .or()", async () => {
    await buscarSkus("1,5L", MARACUMANGO);

    const or = consulta.filtros.find(([c]) => c === "or")?.[1];
    expect(or).toBe("codigo.ilike.%1 5L%,nombre.ilike.%1 5L%");
  });

  it("arma la etiqueta con código y nombre", async () => {
    consulta.data = [
      {
        id: "s1",
        codigo: "MRC-001",
        nombre: "Néctar 1L",
        tenant_id: MARACUMANGO,
      },
    ];

    const r = await buscarSkus("néctar", MARACUMANGO);

    expect(r).toEqual({
      ok: true,
      opciones: [
        { id: "s1", etiqueta: "MRC-001 · Néctar 1L", tenant_id: MARACUMANGO },
      ],
    });
  });

  it("un fallo de la consulta devuelve un error que se puede enseñar", async () => {
    consulta.data = null;
    consulta.error = { message: "permission denied" };

    const r = await buscarSkus("néctar", MARACUMANGO);

    expect(r).toEqual({ ok: false, error: "No se pudo buscar. Reintenta." });
  });
});

describe("buscarTiendas", () => {
  const TIENDA = {
    id: "t1",
    nombre: "Angamos",
    tenant_id: MARACUMANGO,
    cadena: { nombre: "Plaza Vea" },
    tenant: { nombre: "Maracumango" },
  };

  it("acotada a un cliente, la etiqueta no repite el cliente", async () => {
    consulta.data = [TIENDA];

    const r = await buscarTiendas("anga", MARACUMANGO);

    expect(r.ok && r.opciones[0]?.etiqueta).toBe("Plaza Vea · Angamos");
  });

  it("sin acotar (catálogo cross-tenant), la etiqueta dice de quién es", async () => {
    consulta.data = [TIENDA];

    const r = await buscarTiendas("anga", null);

    expect(r.ok && r.opciones[0]?.etiqueta).toBe(
      "Plaza Vea · Angamos (Maracumango)",
    );
    expect(consulta.filtros.some(([c]) => c === "tenant_id")).toBe(false);
  });

  it("escapa los comodines del ilike", async () => {
    await buscarTiendas("100%", MARACUMANGO);

    const patron = consulta.filtros.find(([c]) => c === "ilike:nombre")?.[1];
    expect(patron).toBe("%100\\%%");
  });
});
