import { beforeEach, describe, expect, it, vi } from "vitest";

import { marcarContingenciaAtendida } from "./acciones-tablero";

// El gate de autorización de "Marcar atendida". Una server action es un endpoint
// POST: no la protege que el botón solo se pinte en `/supervisor`, así que estas
// ramas son la defensa real.

const { from, revalidatePath } = vi.hoisted(() => ({
  from: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => Promise.resolve({ from }),
}));

// Un id con la forma del seed del proyecto: NO cumple los bits de versión del
// RFC 9562, igual que los de la base real. Con `z.uuid()` en vez de `z.guid()`
// la acción lo rechazaría — este test es lo que lo caza.
const ID = "a0000016-0000-0000-0000-000000000001";

/** El `select('rol').maybeSingle()` con el que la acción resuelve quién llama. */
function perfil(rol: string | null) {
  return {
    select: () => ({
      maybeSingle: () =>
        Promise.resolve({ data: rol === null ? null : { rol }, error: null }),
    }),
  };
}

type RespuestaAlerta = {
  data: { id: string }[] | null;
  error: { message: string } | null;
};

/** El `update(...).eq(...).eq(...).select()` de la alerta. */
function alerta(resultado: RespuestaAlerta) {
  const encadenable = {
    update: () => encadenable,
    eq: () => encadenable,
    select: () => Promise.resolve(resultado),
  };
  return encadenable;
}

/** Encadena las respuestas por tabla, en el orden en que la acción las pide. */
function conSupabase(
  rol: string | null,
  resultadoAlerta: RespuestaAlerta = { data: [{ id: ID }], error: null },
) {
  from.mockImplementation((tabla: string) =>
    tabla === "profile" ? perfil(rol) : alerta(resultadoAlerta),
  );
}

beforeEach(() => {
  from.mockReset();
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
    expect(from).not.toHaveBeenCalledWith("alerta");
  });

  it("el cliente-marca tampoco", async () => {
    conSupabase("cliente");
    await expect(marcarContingenciaAtendida({ id: ID })).resolves.toMatchObject(
      { ok: false },
    );
    expect(from).not.toHaveBeenCalledWith("alerta");
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
    expect(from).not.toHaveBeenCalled();
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
