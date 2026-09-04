import { beforeEach, describe, expect, it, vi } from "vitest";

import { sesionDeStaff } from "./sesion";
import { perfilesConStaff, supabaseFalso } from "./supabase-falso";

// El gate de autorización de todo el panel. Una server action es un endpoint POST:
// que el botón solo se pinte en `/supervisor` no protege nada.

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
});

describe("sesionDeStaff", () => {
  it("deja pasar al supervisor y devuelve su perfil", async () => {
    conPerfiles({ perfiles: perfilesConStaff("supervisor") });
    const sesion = await sesionDeStaff();
    expect(sesion?.perfil).toMatchObject({
      rol: "supervisor",
      nombre: "Carla",
    });
  });

  it("deja pasar al admin", async () => {
    conPerfiles({ perfiles: perfilesConStaff("admin") });
    await expect(sesionDeStaff()).resolves.not.toBeNull();
  });

  it("resuelve al que llama entre TODOS los perfiles que el staff puede leer", async () => {
    // La prueba de fuego del filtro por id. `profile_staff_lee_todo` le deja al
    // staff leer la tabla entera: sin `.eq('id', …)` la consulta trae varias filas,
    // `maybeSingle()` las rechaza y el gate concluye "no es staff" — justo para las
    // dos únicas personas que sí lo son. Con tres perfiles en la tabla, este test
    // se pone rojo en cuanto alguien quita el filtro.
    const { perfiles } = { perfiles: perfilesConStaff("supervisor") };
    expect(perfiles.length).toBeGreaterThan(1);
    conPerfiles({ perfiles });
    const sesion = await sesionDeStaff();
    expect(sesion?.perfil.id).toBe("u1");
  });

  it("el mercaderista no pasa", async () => {
    conPerfiles({ perfiles: perfilesConStaff("mercaderista") });
    await expect(sesionDeStaff()).resolves.toBeNull();
  });

  it("el cliente-marca tampoco", async () => {
    conPerfiles({ perfiles: perfilesConStaff("cliente") });
    await expect(sesionDeStaff()).resolves.toBeNull();
  });

  it("sin sesión no se consulta ni el perfil", async () => {
    const { tablasPedidas } = conPerfiles({
      usuarioId: null,
      perfiles: perfilesConStaff("admin"),
    });
    await expect(sesionDeStaff()).resolves.toBeNull();
    expect(tablasPedidas).not.toContain("profile");
  });

  it("un usuario con sesión pero sin fila de perfil no pasa", async () => {
    conPerfiles({ perfiles: perfilesConStaff(null) });
    await expect(sesionDeStaff()).resolves.toBeNull();
  });
});
