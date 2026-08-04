import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolverSolicitud } from "./acciones-solicitudes";

// El gate de autorización de "resolver". Una server action es un endpoint POST:
// que el botón solo se pinte en `/supervisor` no protege nada.

const { from, revalidatePath } = vi.hoisted(() => ({
  from: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => Promise.resolve({ from }),
}));

const ID = "a0000020-0000-0000-0000-000000000001";
const VALIDO = { id: ID, decision: "resuelta", comentario: "Aprobado" };

type RespuestaUpdate = {
  data: { id: string }[] | null;
  error: { message: string } | null;
};

function perfil(rol: string | null) {
  return {
    select: () => ({
      maybeSingle: () =>
        Promise.resolve({
          data: rol === null ? null : { id: "p1", rol, nombre: "Carla" },
          error: null,
        }),
    }),
  };
}

function solicitudes(resultado: RespuestaUpdate) {
  const encadenable = {
    update: () => encadenable,
    eq: () => encadenable,
    select: () => Promise.resolve(resultado),
  };
  return encadenable;
}

function conSupabase(
  rol: string | null,
  resultado: RespuestaUpdate = { data: [{ id: ID }], error: null },
) {
  from.mockImplementation((tabla: string) =>
    tabla === "profile" ? perfil(rol) : solicitudes(resultado),
  );
}

beforeEach(() => {
  from.mockReset();
  revalidatePath.mockReset();
});

describe("resolverSolicitud", () => {
  it("el supervisor aprueba y se registra quién resolvió", async () => {
    conSupabase("supervisor");
    const r = await resolverSolicitud(VALIDO);
    expect(r).toMatchObject({ ok: true, resueltaPorNombre: "Carla" });
    expect(revalidatePath).toHaveBeenCalledWith("/supervisor/solicitudes");
  });

  it("el admin también", async () => {
    conSupabase("admin");
    await expect(resolverSolicitud(VALIDO)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("el mercaderista NO puede resolver la solicitud que él pidió", async () => {
    conSupabase("mercaderista");
    const r = await resolverSolicitud(VALIDO);
    expect(r).toEqual({ ok: false, error: "No encontrada o sin permiso" });
    expect(from).not.toHaveBeenCalledWith("solicitud_cambio_ruta");
  });

  it("el cliente-marca tampoco: no es asunto suyo", async () => {
    conSupabase("cliente");
    await expect(resolverSolicitud(VALIDO)).resolves.toMatchObject({
      ok: false,
    });
    expect(from).not.toHaveBeenCalledWith("solicitud_cambio_ruta");
  });

  it("el comentario es obligatorio, también al aprobar", async () => {
    // El mercaderista tiene que saber QUÉ se decidió sobre su ruta, no solo que
    // alguien la tocó.
    conSupabase("supervisor");
    const r = await resolverSolicitud({ ...VALIDO, comentario: "   " });
    expect(r).toMatchObject({ ok: false });
    expect(from).not.toHaveBeenCalled();
  });

  it("no se puede devolver una solicitud a `nueva` por esta vía", async () => {
    conSupabase("supervisor");
    const r = await resolverSolicitud({ ...VALIDO, decision: "nueva" });
    expect(r).toMatchObject({ ok: false });
    expect(from).not.toHaveBeenCalled();
  });

  it("cero filas afectadas es un fallo, no un éxito silencioso", async () => {
    conSupabase("supervisor", { data: [], error: null });
    await expect(resolverSolicitud(VALIDO)).resolves.toEqual({
      ok: false,
      error: "No encontrada o sin permiso",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("un error de la base no se propaga crudo al usuario", async () => {
    conSupabase("supervisor", {
      data: null,
      error: { message: "connection to 10.0.0.1 failed: password=hunter2" },
    });
    await expect(resolverSolicitud(VALIDO)).resolves.toEqual({
      ok: false,
      error: "No se pudo resolver la solicitud",
    });
  });
});
