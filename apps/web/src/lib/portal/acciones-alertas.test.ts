import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseFalso } from "@/lib/panel/supabase-falso";

import { marcarEstadoAlerta } from "./acciones-alertas";

// El ciclo de triage de una alerta. Lo que más importa aquí no es el camino
// feliz: es que un update que la RLS bloquea NO da error, así que sin comprobar
// las filas afectadas la pantalla diría "Guardado" sin guardar nada.

type ClienteFalso = ReturnType<typeof supabaseFalso>["cliente"];

const { cliente, revalidados } = vi.hoisted(() => ({
  cliente: { actual: null as ClienteFalso | null },
  revalidados: [] as string[],
}));

vi.mock("next/cache", () => ({
  revalidatePath: (ruta: string) => revalidados.push(ruta),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => Promise.resolve(cliente.actual),
}));

const ALERTA = "a0000016-0000-0000-0000-000000000001";

function conEscritura(escritura: {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
}) {
  const falso = supabaseFalso({ escritura });
  cliente.actual = falso.cliente;
  return falso;
}

beforeEach(() => {
  revalidados.length = 0;
  vi.restoreAllMocks();
});

describe("marcarEstadoAlerta", () => {
  it("marca el estado y lo devuelve", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    conEscritura({ data: [{ id: ALERTA, estado: "vista" }], error: null });

    const r = await marcarEstadoAlerta({ alertaId: ALERTA, estado: "vista" });

    expect(r).toEqual({ ok: true, estado: "vista" });
  });

  it("CERO filas no es éxito: la RLS bloqueó el update sin dar error", async () => {
    // El caso real: un cliente cuyo acceso se revocó con el token todavía vivo.
    // PostgREST responde 200 con una lista vacía.
    vi.spyOn(console, "info").mockImplementation(() => {});
    conEscritura({ data: [], error: null });

    const r = await marcarEstadoAlerta({ alertaId: ALERTA, estado: "vista" });

    expect(r.ok).toBe(false);
  });

  it("una alerta ajena y una inexistente dan el MISMO mensaje", async () => {
    // Distinguirlas confirmaría que la ajena existe.
    conEscritura({ data: [], error: null });
    const ajena = await marcarEstadoAlerta({
      alertaId: ALERTA,
      estado: "vista",
    });

    conEscritura({ data: null, error: { message: "no existe" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const inexistente = await marcarEstadoAlerta({
      alertaId: "a0000016-0000-0000-0000-0000000000ff",
      estado: "vista",
    });

    expect(ajena).toEqual(inexistente);
  });

  it("un fallo del driver no se le enseña al usuario, se registra recortado", async () => {
    // El mensaje de un driver puede arrastrar contenido de la respuesta.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    conEscritura({ data: null, error: { message: "x".repeat(500) } });

    const r = await marcarEstadoAlerta({ alertaId: ALERTA, estado: "vista" });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain("xxx");
    expect(String(error.mock.calls[0]?.[1])).toHaveLength(200);
  });

  it("rechaza un id que no es uuid antes de tocar la base", async () => {
    const falso = conEscritura({ data: [], error: null });
    const r = await marcarEstadoAlerta({
      alertaId: "../../alerta",
      estado: "vista",
    });

    expect(r.ok).toBe(false);
    expect(falso.tablasPedidas).toEqual([]);
  });

  it("rechaza un estado que no está en el enum", async () => {
    const falso = conEscritura({ data: [], error: null });
    const r = await marcarEstadoAlerta({
      alertaId: ALERTA,
      estado: "archivada",
    });

    expect(r.ok).toBe(false);
    expect(falso.tablasPedidas).toEqual([]);
  });

  it("apunta a LA alerta pedida, no a cualquiera", async () => {
    // Sin esta afirmación, un update sin filtrar por id (o filtrando por otro)
    // pasaría igual: el doble devuelve su resultado venga como venga la consulta.
    vi.spyOn(console, "info").mockImplementation(() => {});
    const falso = conEscritura({
      data: [{ id: ALERTA, estado: "vista" }],
      error: null,
    });

    await marcarEstadoAlerta({ alertaId: ALERTA, estado: "vista" });

    expect(falso.filtrosDeEscritura).toEqual([["id", ALERTA]]);
  });

  it("escribe SOLO sobre `alerta`: la evidencia no se toca", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const falso = conEscritura({
      data: [{ id: ALERTA, estado: "resuelta" }],
      error: null,
    });

    await marcarEstadoAlerta({ alertaId: ALERTA, estado: "resuelta" });

    expect(falso.tablasPedidas).toEqual(["alerta"]);
  });

  it("refresca la bandeja Y el detalle: el estado se ve en las dos", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    conEscritura({ data: [{ id: ALERTA, estado: "vista" }], error: null });

    await marcarEstadoAlerta({ alertaId: ALERTA, estado: "vista" });

    expect(revalidados).toEqual([
      "/cliente/alertas",
      `/cliente/alertas/${ALERTA}`,
    ]);
  });

  it("deja rastro del cambio para poder reconstruir el triage", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    conEscritura({ data: [{ id: ALERTA, estado: "resuelta" }], error: null });

    await marcarEstadoAlerta({ alertaId: ALERTA, estado: "resuelta" });

    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({
      evento: "alerta_estado_cambiado",
      alerta_id: ALERTA,
      a: "resuelta",
    });
  });
});
