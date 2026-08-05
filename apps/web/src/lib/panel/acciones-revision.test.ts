import { beforeEach, describe, expect, it, vi } from "vitest";

import { revisarVisita } from "./acciones-revision";
import { perfilesConStaff, supabaseFalso } from "./supabase-falso";

// El gate y la validación de la decisión de revisión. Una server action es un
// endpoint POST: que el botón viva en `/supervisor` no protege nada.

const { crearCliente, revalidatePath } = vi.hoisted(() => ({
  crearCliente: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => Promise.resolve(crearCliente()),
}));

// Un id con la forma del seed: NO cumple los bits de versión del RFC 9562. Con
// `z.uuid()` en vez de `z.guid()` la acción lo rechazaría.
const VISITA = "a0000010-0000-0000-0000-000000000001";

let espia: ReturnType<typeof supabaseFalso>;

function conSupabase(
  rol: string | null,
  opciones: Partial<Parameters<typeof supabaseFalso>[0]> = {},
) {
  espia = supabaseFalso({ perfiles: perfilesConStaff(rol), ...opciones });
  crearCliente.mockReturnValue(espia.cliente);
  return espia;
}

beforeEach(() => {
  crearCliente.mockReset();
  revalidatePath.mockReset();
});

describe("revisarVisita", () => {
  it("el supervisor aprueba y se devuelve quién decidió y cuándo", async () => {
    // El `revisado_at` lo pone la base (`now()`), no el navegador: la UI lo pinta
    // tal cual llega en vez de inventarse la hora del cliente.
    conSupabase("supervisor", {
      rpc: { data: "2026-08-05T14:00:00.000Z", error: null },
    });
    const r = await revisarVisita({ visitaId: VISITA, decision: "aprobada" });
    expect(r).toMatchObject({
      ok: true,
      revisorNombre: "Carla",
      revisadoAt: "2026-08-05T14:00:00.000Z",
    });
    expect(espia.rpcsPedidas[0]).toMatchObject({
      nombre: "revisar_visita",
      argumentos: { p_visita_id: VISITA, p_decision: "aprobada" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/supervisor/revision");
  });

  it("el admin también decide", async () => {
    conSupabase("admin");
    await expect(
      revisarVisita({ visitaId: VISITA, decision: "aprobada" }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("rechazar con motivo lo manda tal cual", async () => {
    conSupabase("supervisor");
    await expect(
      revisarVisita({
        visitaId: VISITA,
        decision: "rechazada",
        motivo: "Falta la foto Después",
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(espia.rpcsPedidas[0]?.argumentos).toMatchObject({
      p_motivo: "Falta la foto Después",
    });
  });

  it("rechazar SIN motivo no llega a la base", async () => {
    // El motivo es lo único que le dice al mercaderista qué corregir. La base lo
    // exige con un CHECK; esto lo para antes y con mejor mensaje.
    conSupabase("supervisor");
    const r = await revisarVisita({ visitaId: VISITA, decision: "rechazada" });
    expect(r).toMatchObject({ ok: false, error: "Explica por qué se rechaza" });
    expect(crearCliente).not.toHaveBeenCalled();
  });

  it("un motivo de solo espacios cuenta como no haberlo escrito", async () => {
    conSupabase("supervisor");
    await expect(
      revisarVisita({ visitaId: VISITA, decision: "rechazada", motivo: "   " }),
    ).resolves.toMatchObject({ ok: false });
    expect(crearCliente).not.toHaveBeenCalled();
  });

  it("aprobar SÍ puede ir sin motivo: una cola de 50 se atasca si no", async () => {
    conSupabase("supervisor");
    await expect(
      revisarVisita({ visitaId: VISITA, decision: "aprobada" }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("el mercaderista no puede revisar nada", async () => {
    conSupabase("mercaderista");
    await expect(
      revisarVisita({ visitaId: VISITA, decision: "aprobada" }),
    ).resolves.toMatchObject({ ok: false });
    expect(espia.rpcsPedidas).toHaveLength(0);
  });

  it("el cliente-marca tampoco: no es asunto suyo", async () => {
    conSupabase("cliente");
    await expect(
      revisarVisita({ visitaId: VISITA, decision: "aprobada" }),
    ).resolves.toMatchObject({ ok: false });
    expect(espia.rpcsPedidas).toHaveLength(0);
  });

  it("sin sesión no se decide", async () => {
    conSupabase("supervisor", { usuarioId: null });
    await expect(
      revisarVisita({ visitaId: VISITA, decision: "aprobada" }),
    ).resolves.toMatchObject({ ok: false });
    expect(espia.rpcsPedidas).toHaveLength(0);
  });

  it("una decisión que no existe se rechaza en la frontera", async () => {
    conSupabase("supervisor");
    await expect(
      revisarVisita({ visitaId: VISITA, decision: "quizas" }),
    ).resolves.toMatchObject({ ok: false });
    expect(crearCliente).not.toHaveBeenCalled();
  });

  it("un motivo más largo que el tope de la base se corta aquí", async () => {
    conSupabase("supervisor");
    await expect(
      revisarVisita({
        visitaId: VISITA,
        decision: "rechazada",
        motivo: "x".repeat(501),
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(crearCliente).not.toHaveBeenCalled();
  });

  it("si la base falla, no se filtra el mensaje de infraestructura", async () => {
    conSupabase("supervisor", {
      rpc: { error: { message: "connection to server at 10.0.0.1 failed" } },
    });
    const r = await revisarVisita({ visitaId: VISITA, decision: "aprobada" });
    expect(r).toEqual({ ok: false, error: "No encontrada o sin permiso" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
