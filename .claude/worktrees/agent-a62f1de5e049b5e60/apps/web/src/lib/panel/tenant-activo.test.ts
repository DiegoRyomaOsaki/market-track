import { beforeEach, describe, expect, it, vi } from "vitest";

import { tenantActivo } from "./tenant-activo";

const { consulta, cookie } = vi.hoisted(() => ({
  consulta: {
    data: null as { id: string; nombre: string }[] | null,
    error: null as { message: string } | null,
  },
  cookie: { valor: undefined as string | undefined },
}));

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: () =>
        cookie.valor === undefined ? undefined : { value: cookie.valor },
    }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () =>
    Promise.resolve({
      from: () => ({
        select: () => ({
          eq: () => ({ order: () => Promise.resolve(consulta) }),
        }),
      }),
    }),
}));

const MARACUMANGO = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  nombre: "Maracumango",
};
const OTRO = {
  id: "bbbbbbbb-0000-0000-0000-000000000002",
  nombre: "Otro cliente",
};

beforeEach(() => {
  consulta.data = [MARACUMANGO, OTRO];
  consulta.error = null;
  cookie.valor = undefined;
});

describe("tenantActivo", () => {
  it("respeta la cookie cuando apunta a un cliente que la RLS devolvió", async () => {
    cookie.valor = OTRO.id;
    expect(await tenantActivo()).toEqual(OTRO);
  });

  it("una cookie con un id AJENO no lo selecciona: cae al primero", async () => {
    // Es la defensa que hace que la cookie sea una preferencia y no una
    // autoridad. Sin ella, el maestro se aplicaría al cliente que el navegador
    // dijera.
    cookie.valor = "cccccccc-0000-0000-0000-000000000009";
    expect(await tenantActivo()).toEqual(MARACUMANGO);
  });

  it("sin cookie toma el primero de la lista", async () => {
    expect(await tenantActivo()).toEqual(MARACUMANGO);
  });

  it("si la consulta falla devuelve null, no un tenant a medias", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    consulta.error = { message: "permission denied for table tenant" };

    expect(await tenantActivo()).toBeNull();
    expect(error).toHaveBeenCalled();
  });

  it("sin ningún cliente activo devuelve null", async () => {
    consulta.data = [];
    expect(await tenantActivo()).toBeNull();
  });
});
