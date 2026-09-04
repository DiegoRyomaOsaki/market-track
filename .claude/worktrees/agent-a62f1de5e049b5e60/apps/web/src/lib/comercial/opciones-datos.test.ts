import { beforeEach, describe, expect, it, vi } from "vitest";

import { clustersPorCliente, skusActivos } from "./opciones-datos";

// Lo que se prueba de este módulo es lo que sus consultas EXCLUYEN.
//
// Si se cae el `.eq("activo", true)`, los formularios vuelven a ofrecer un SKU
// dado de baja y se negocia una cabecera para un producto descontinuado — un
// error que nadie ve hasta que el mercaderista lo busca en góndola.

type Filtro = [string, unknown];

const { consulta } = vi.hoisted(() => ({
  consulta: {
    data: [] as Record<string, unknown>[],
    filtros: [] as Filtro[],
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
      not: (columna: string, operador: string) => {
        consulta.filtros.push([columna, operador]);
        return encadenable;
      },
      order: () => Promise.resolve({ data: consulta.data, error: null }),
      then: (resolver: (r: unknown) => unknown) =>
        Promise.resolve({ data: consulta.data, error: null }).then(resolver),
    };
    return Promise.resolve({ from: () => encadenable });
  },
}));

const MARACUMANGO = "aaaaaaaa-0000-0000-0000-000000000001";
const RIVAL = "bbbbbbbb-0000-0000-0000-000000000002";

beforeEach(() => {
  consulta.data = [];
  consulta.filtros = [];
});

describe("skusActivos", () => {
  it("pide SOLO los activos: un SKU de baja no se puede referenciar", async () => {
    consulta.data = [
      {
        id: "s1",
        codigo: "MRC-001",
        nombre: "Néctar 1L",
        tenant_id: MARACUMANGO,
        tenant: { nombre: "Maracumango" },
      },
    ];

    await skusActivos();

    expect(consulta.filtros).toContainEqual(["activo", true]);
  });

  it("aplana el nombre del cliente para que el desplegable lo pueda mostrar", async () => {
    consulta.data = [
      {
        id: "s1",
        codigo: "MRC-001",
        nombre: "Néctar 1L",
        tenant_id: MARACUMANGO,
        tenant: { nombre: "Maracumango" },
      },
    ];

    expect(await skusActivos()).toEqual([
      {
        id: "s1",
        codigo: "MRC-001",
        nombre: "Néctar 1L",
        tenant_id: MARACUMANGO,
        cliente: "Maracumango",
      },
    ]);
  });

  it("un SKU sin cliente resoluble no rompe la lista", async () => {
    consulta.data = [
      {
        id: "s1",
        codigo: "MRC-001",
        nombre: "Néctar 1L",
        tenant_id: MARACUMANGO,
        tenant: null,
      },
    ];

    expect((await skusActivos())[0]?.cliente).toBe("—");
  });
});

describe("clustersPorCliente", () => {
  it("cada cluster aparece UNA vez aunque lo tengan veinte tiendas", async () => {
    consulta.data = [
      { tenant_id: MARACUMANGO, cluster: "Lima Norte" },
      { tenant_id: MARACUMANGO, cluster: "Lima Norte" },
      { tenant_id: MARACUMANGO, cluster: "Lima Sur" },
    ];

    expect(await clustersPorCliente()).toEqual({
      [MARACUMANGO]: ["Lima Norte", "Lima Sur"],
    });
  });

  it("no mezcla los clusters de un cliente con los de otro", async () => {
    // Ofrecer el cluster de otro cliente acotaría la promo a cero tiendas.
    consulta.data = [
      { tenant_id: MARACUMANGO, cluster: "Lima Norte" },
      { tenant_id: RIVAL, cluster: "Arequipa" },
    ];

    expect(await clustersPorCliente()).toEqual({
      [MARACUMANGO]: ["Lima Norte"],
      [RIVAL]: ["Arequipa"],
    });
  });

  it("una cadena vacía no cuenta como cluster", async () => {
    consulta.data = [
      { tenant_id: MARACUMANGO, cluster: "" },
      { tenant_id: MARACUMANGO, cluster: null },
    ];

    expect(await clustersPorCliente()).toEqual({});
  });
});
