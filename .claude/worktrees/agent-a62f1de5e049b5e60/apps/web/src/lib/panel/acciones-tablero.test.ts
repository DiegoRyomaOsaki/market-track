import { beforeEach, describe, expect, it, vi } from "vitest";

import { marcarContingenciaAtendida } from "./acciones-tablero";
import { perfilesConStaff, supabaseFalso } from "./supabase-falso";

// El gate de autorización de "Marcar atendida". Una server action es un endpoint
// POST: no la protege que el botón solo se pinte en `/supervisor`, así que estas
// ramas son la defensa real.

const { crearCliente, revalidatePath } = vi.hoisted(() => ({
  crearCliente: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => Promise.resolve(crearCliente()),
}));

// Un id con la forma del seed del proyecto: NO cumple los bits de versión del
// RFC 9562, igual que los de la base real. Con `z.uuid()` en vez de `z.guid()`
// la acción lo rechazaría — este test es lo que lo caza.
const ID = "a0000016-0000-0000-0000-000000000001";

type RespuestaAlerta = {
  data: { id: string }[] | null;
  error: { message: string } | null;
};

/**
 * El doble mira los perfiles de verdad, con varios en la tabla: si el gate deja
 * de filtrar por el id del que llama, `maybeSingle()` falla igual que en
 * producción y estos tests se ponen rojos.
 */
let espia: ReturnType<typeof supabaseFalso>;

function conSupabase(
  rol: string | null,
  resultadoAlerta: RespuestaAlerta = { data: [{ id: ID }], error: null },
) {
  const falso = supabaseFalso({
    perfiles: perfilesConStaff(rol),
    escritura: resultadoAlerta,
  });
  crearCliente.mockReturnValue(falso.cliente);
  espia = falso;
  return falso;
}

beforeEach(() => {
  crearCliente.mockReset();
  revalidatePath.mockReset();
});

describe("marcarContingenciaAtendida", () => {
  it("el supervisor la cierra", async () => {
    conSupabase("supervisor");
    await expect(marcarContingenciaAtendida({ id: ID })).resolves.toEqual({
      ok: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/supervisor");
  });

  it("el admin también", async () => {
    conSupabase("admin");
    await expect(marcarContingenciaAtendida({ id: ID })).resolves.toEqual({
      ok: true,
    });
  });

  it("el mercaderista NO puede apagar la contingencia que él generó", async () => {
    // La RLS de `alerta` deja cambiar el estado a cualquiera del mismo tenant, así
    // que sin este gate el mercaderista cerraría el aviso antes de que el
    // supervisor lo viera — y el bypass dejaría de ser un canal de auditoría.
    conSupabase("mercaderista");
    const r = await marcarContingenciaAtendida({ id: ID });
    expect(r).toEqual({ ok: false, error: "No encontrado o sin permiso" });
    expect(espia.tablasPedidas).not.toContain("alerta");
  });

  it("el cliente-marca tampoco", async () => {
    conSupabase("cliente");
    await expect(marcarContingenciaAtendida({ id: ID })).resolves.toMatchObject(
      { ok: false },
    );
    expect(espia.tablasPedidas).not.toContain("alerta");
  });

  it("sin perfil legible no pasa nadie", async () => {
    conSupabase(null);
    await expect(marcarContingenciaAtendida({ id: ID })).resolves.toMatchObject(
      { ok: false },
    );
  });

  it("un id que no es uuid se rechaza antes de tocar la base", async () => {
    conSupabase("supervisor");
    const r = await marcarContingenciaAtendida({ id: "no-es-uuid" });
    expect(r).toEqual({
      ok: false,
      error: "Identificador de alerta inválido",
    });
    expect(crearCliente).not.toHaveBeenCalled();
  });

  it("cero filas afectadas es un fallo, no un éxito silencioso", async () => {
    // Un UPDATE que la RLS bloquea no da error: devuelve 0 filas. Si esto se
    // tomara por éxito, la UI diría "Atendida" sobre algo que sigue abierto.
    conSupabase("supervisor", { data: [], error: null });
    await expect(marcarContingenciaAtendida({ id: ID })).resolves.toEqual({
      ok: false,
      error: "No encontrado o sin permiso",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("un error de la base no se propaga crudo al usuario", async () => {
    conSupabase("supervisor", {
      data: null,
      error: { message: "connection to server at 10.0.0.1 failed: password" },
    });
    const r = await marcarContingenciaAtendida({ id: ID });
    expect(r).toEqual({
      ok: false,
      error: "No se pudo marcar la contingencia",
    });
  });
});
