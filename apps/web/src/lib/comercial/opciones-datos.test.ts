import { beforeEach, describe, expect, it, vi } from "vitest";

import { cadenasActivas, clustersDe, marcasActivas } from "./opciones-datos";

// Lo que se prueba de este módulo es lo que sus consultas EXCLUYEN.
//
// Si se cae el `.eq("activo", true)`, los formularios vuelven a ofrecer una
// cadena dada de baja. Y si se cae el `.eq("tenant_id", ...)`, cada formulario
// vuelve a precargar el catálogo de TODOS los clientes para ofrecer el de uno
// — invisible en una base de desarrollo con un solo cliente, que es justo por
// lo que se fija aquí.

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

beforeEach(() => {
  consulta.data = [];
  consulta.filtros = [];
});

describe("cadenasActivas", () => {
  it("pide SOLO las activas y SOLO las del cliente", async () => {
    await cadenasActivas(MARACUMANGO);

    expect(consulta.filtros).toContainEqual(["activo", true]);
    expect(consulta.filtros).toContainEqual(["tenant_id", MARACUMANGO]);
  });
});

describe("marcasActivas", () => {
  it("pide SOLO las activas y SOLO las del cliente", async () => {
    await marcasActivas(MARACUMANGO);

    expect(consulta.filtros).toContainEqual(["activo", true]);
    expect(consulta.filtros).toContainEqual(["tenant_id", MARACUMANGO]);
  });
});

describe("clustersDe", () => {
  it("acota la lectura al cliente que se pide", async () => {
    // Sin el filtro, se leen las tiendas de TODO el sistema para sacar cuatro
    // etiquetas — la consulta más cara del formulario de promociones.
    await clustersDe(MARACUMANGO);

    expect(consulta.filtros).toContainEqual(["tenant_id", MARACUMANGO]);
    expect(consulta.filtros).toContainEqual(["activo", true]);
  });

  it("cada cluster aparece UNA vez aunque lo tengan veinte tiendas", async () => {
    consulta.data = [
      { cluster: "Lima Norte" },
      { cluster: "Lima Norte" },
      { cluster: "Lima Sur" },
    ];

    expect(await clustersDe(MARACUMANGO)).toEqual(["Lima Norte", "Lima Sur"]);
  });

  it("una cadena vacía no cuenta como cluster", async () => {
    consulta.data = [{ cluster: "" }, { cluster: null }];

    expect(await clustersDe(MARACUMANGO)).toEqual([]);
  });
});
