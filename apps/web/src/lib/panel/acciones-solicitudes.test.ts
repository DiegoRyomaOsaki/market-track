import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolverSolicitud } from "./acciones-solicitudes";
import { perfilesConStaff, supabaseFalso } from "./supabase-falso";

// El gate de autorización de "resolver". Una server action es un endpoint POST:
// que el botón solo se pinte en `/supervisor` no protege nada.

const { crearCliente, revalidatePath } = vi.hoisted(() => ({
  crearCliente: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => Promise.resolve(crearCliente()),
}));

const ID = "a0000020-0000-0000-0000-000000000001";
const VALIDO = { id: ID, decision: "resuelta", comentario: "Aprobado" };

type RespuestaUpdate = {
  data: { id: string }[] | null;
  error: { message: string } | null;
};

let espia: ReturnType<typeof supabaseFalso>;

/**
 * El doble consulta los perfiles de verdad, con varios en la tabla: si el gate
 * deja de filtrar por el id del que llama, `maybeSingle()` falla igual que en
 * producción y estos tests se ponen rojos.
 */
function conSupabase(
  rol: string | null,
  resultado: RespuestaUpdate = { data: [{ id: ID }], error: null },
) {
  const falso = supabaseFalso({
    perfiles: perfilesConStaff(rol),
    escritura: resultado,
  });
  crearCliente.mockReturnValue(falso.cliente);
  espia = falso;
  return falso;
}

beforeEach(() => {
  crearCliente.mockReset();
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
    expect(espia.tablasPedidas).not.toContain("solicitud_cambio_ruta");
  });

  it("el cliente-marca tampoco: no es asunto suyo", async () => {
    conSupabase("cliente");
    await expect(resolverSolicitud(VALIDO)).resolves.toMatchObject({
      ok: false,
    });
    expect(espia.tablasPedidas).not.toContain("solicitud_cambio_ruta");
  });

  it("el comentario es obligatorio, también al aprobar", async () => {
    // El mercaderista tiene que saber QUÉ se decidió sobre su ruta, no solo que
    // alguien la tocó.
    conSupabase("supervisor");
    const r = await resolverSolicitud({ ...VALIDO, comentario: "   " });
    expect(r).toMatchObject({ ok: false });
    expect(crearCliente).not.toHaveBeenCalled();
  });

  it("no se puede devolver una solicitud a `nueva` por esta vía", async () => {
    conSupabase("supervisor");
    const r = await resolverSolicitud({ ...VALIDO, decision: "nueva" });
    expect(r).toMatchObject({ ok: false });
    expect(crearCliente).not.toHaveBeenCalled();
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
