import { beforeEach, describe, expect, it, vi } from "vitest";

import { perfilesConStaff, supabaseFalso } from "@/lib/panel/supabase-falso";

import { sesionDeCliente } from "./sesion";

// El gate del endpoint que sirve el reporte en Excel. Es un GET alcanzable por
// cualquiera con sesión: que el enlace solo se pinte dentro de `/cliente` no
// protege nada.
//
// El doble de `supabase` aplica los `.eq(...)` DE VERDAD, que es lo que hace
// significativos estos tests: un mock que devolviera siempre la misma fila
// daría verde con el filtro y sin él.

const { crearCliente } = vi.hoisted(() => ({ crearCliente: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => Promise.resolve(crearCliente()),
}));

function conPerfiles(...args: Parameters<typeof supabaseFalso>) {
  const falso = supabaseFalso(...args);
  crearCliente.mockReturnValue(falso.cliente);
  return falso;
}

beforeEach(() => {
  crearCliente.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("sesionDeCliente", () => {
  it("deja pasar al cliente-marca y devuelve su perfil", async () => {
    conPerfiles({ perfiles: perfilesConStaff("cliente") });
    const sesion = await sesionDeCliente();

    expect(sesion?.perfil).toMatchObject({ id: "u1", nombre: "Carla" });
  });

  it("resuelve al que llama entre TODOS los perfiles legibles", async () => {
    // La prueba de fuego del `.eq('id', …)`. Sin él la consulta trae varias
    // filas, `maybeSingle()` las rechaza por multiplicidad y el gate concluye
    // lo contrario de lo que debía. Con tres perfiles en la tabla, este test se
    // pone rojo en cuanto alguien quita el filtro.
    const perfiles = perfilesConStaff("cliente");
    expect(perfiles.length).toBeGreaterThan(1);
    conPerfiles({ perfiles });

    expect((await sesionDeCliente())?.perfil.id).toBe("u1");
  });

  it("el supervisor no se lleva el reporte del cliente", async () => {
    conPerfiles({ perfiles: perfilesConStaff("supervisor") });
    await expect(sesionDeCliente()).resolves.toBeNull();
  });

  it("el admin tampoco", async () => {
    conPerfiles({ perfiles: perfilesConStaff("admin") });
    await expect(sesionDeCliente()).resolves.toBeNull();
  });

  it("el mercaderista tampoco", async () => {
    conPerfiles({ perfiles: perfilesConStaff("mercaderista") });
    await expect(sesionDeCliente()).resolves.toBeNull();
  });

  it("sin sesión no se consulta ni el perfil", async () => {
    const { tablasPedidas } = conPerfiles({
      usuarioId: null,
      perfiles: perfilesConStaff("cliente"),
    });

    await expect(sesionDeCliente()).resolves.toBeNull();
    expect(tablasPedidas).not.toContain("profile");
  });

  it("un usuario con sesión pero sin fila de perfil no pasa", async () => {
    conPerfiles({ perfiles: perfilesConStaff(null) });
    await expect(sesionDeCliente()).resolves.toBeNull();
  });

  it("si la consulta del perfil falla, falla CERRADO", async () => {
    // Nunca una sesión a medias: ante la duda, no se sirve el reporte.
    const falso = supabaseFalso({ perfiles: perfilesConStaff("cliente") });
    crearCliente.mockReturnValue({
      ...falso.cliente,
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: null, error: { message: "boom" } }),
          }),
        }),
      }),
    });

    await expect(sesionDeCliente()).resolves.toBeNull();
  });
});
