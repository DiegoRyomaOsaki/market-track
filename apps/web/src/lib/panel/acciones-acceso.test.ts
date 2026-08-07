import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseFalso } from "@/lib/panel/supabase-falso";

import { emitirPase, guardarCanalesOtp, revocarPase } from "./acciones-acceso";

// El camino más sensible del sistema de auth: quien emite un pase puede entrar
// como ese mercaderista. Casi todo lo que se prueba aquí es lo que NO debe pasar.

type ClienteFalso = ReturnType<typeof supabaseFalso>["cliente"];

const { cliente, revalidados } = vi.hoisted(() => ({
  cliente: { actual: null as ClienteFalso | null },
  revalidados: [] as string[],
}));

vi.mock("next/cache", () => ({
  revalidatePath: (ruta: string) => revalidados.push(ruta),
}));

vi.mock("@/lib/env", () => ({
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_ANON_KEY: "anon" },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => Promise.resolve(cliente.actual),
}));

const PASE = "a0000020-0000-0000-0000-000000000001";
const JOSE = "44444444-4444-4444-4444-444444444444";
const CODIGO = "482913";

/** El doble compartido no trae sesión; `emitirPase` la necesita para el JWT. */
function conCliente(opciones: Parameters<typeof supabaseFalso>[0] = {}) {
  const falso = supabaseFalso(opciones);
  cliente.actual = {
    ...falso.cliente,
    auth: {
      ...falso.cliente.auth,
      getSession: () =>
        Promise.resolve({ data: { session: { access_token: "jwt" } } }),
    },
  } as ClienteFalso;
  return falso;
}

function respuesta(status: number, cuerpo: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(cuerpo),
  } as Response;
}

function conFetch(status: number, cuerpo: unknown) {
  const espia = vi.fn(() => Promise.resolve(respuesta(status, cuerpo)));
  vi.stubGlobal("fetch", espia);
  return espia;
}

beforeEach(() => {
  revalidados.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("emitirPase", () => {
  const EMITIDO = {
    id: PASE,
    codigo: CODIGO,
    expira_at: "2026-08-07T15:15:00.000Z",
  };

  it("devuelve el código y la expiración una sola vez", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    conCliente();
    conFetch(201, EMITIDO);

    expect(
      await emitirPase({ profileId: JOSE, motivo: "No le llega" }),
    ).toEqual({
      ok: true,
      codigo: CODIGO,
      expiraAt: "2026-08-07T15:15:00.000Z",
    });
  });

  it("el CÓDIGO no aparece en ningún log", async () => {
    // Quien lea ese log podría entrar como el mercaderista. Se registra el id del
    // pase, nunca el secreto.
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    conCliente();
    conFetch(201, EMITIDO);

    await emitirPase({ profileId: JOSE, motivo: "No le llega" });

    const escrito = [...info.mock.calls, ...error.mock.calls]
      .flat()
      .map(String)
      .join(" ");
    expect(escrito).not.toContain(CODIGO);
    expect(escrito).toContain(PASE);
  });

  it("un motivo vacío no llega a la Edge Function", async () => {
    // El motivo es lo único que explica por qué alguien recibió acceso.
    conCliente();
    const llamar = conFetch(201, EMITIDO);

    const r = await emitirPase({ profileId: JOSE, motivo: "   " });

    expect(r.ok).toBe(false);
    expect(llamar).not.toHaveBeenCalled();
  });

  it("propaga el límite diario tal y como lo explica el servidor", async () => {
    conCliente();
    conFetch(429, { error: "Límite diario alcanzado" });

    expect(await emitirPase({ profileId: JOSE, motivo: "x" })).toEqual({
      ok: false,
      error: "Límite diario alcanzado",
    });
  });

  it("propaga el 403 del alcance por rol", async () => {
    // El supervisor apuntando a un mercaderista ajeno: la Edge Function ya lo
    // replica en servidor porque corre con service_role y salta la RLS.
    conCliente();
    conFetch(403, { error: "Sin permiso" });

    expect(await emitirPase({ profileId: JOSE, motivo: "x" })).toEqual({
      ok: false,
      error: "Sin permiso",
    });
  });

  it("si la función no contesta, lo dice sin filtrar el motivo técnico", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    conCliente();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.1"))),
    );

    const r = await emitirPase({ profileId: JOSE, motivo: "x" });

    expect(r).toEqual({ ok: false, error: "No se pudo emitir el pase" });
    expect(String(error.mock.calls[0]?.[1])).toContain("ECONNREFUSED");
  });

  it("una respuesta 201 SIN código no se da por buena", async () => {
    // Darla por buena dejaría al operador dictando una cadena vacía por teléfono.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    conCliente();
    conFetch(201, { id: PASE });

    expect((await emitirPase({ profileId: JOSE, motivo: "x" })).ok).toBe(false);
    expect(error).toHaveBeenCalled();
  });

  it("sin sesión no se emite nada", async () => {
    const falso = supabaseFalso();
    cliente.actual = {
      ...falso.cliente,
      auth: {
        ...falso.cliente.auth,
        getSession: () => Promise.resolve({ data: { session: null } }),
      },
    } as ClienteFalso;
    const llamar = conFetch(201, EMITIDO);

    expect((await emitirPase({ profileId: JOSE, motivo: "x" })).ok).toBe(false);
    expect(llamar).not.toHaveBeenCalled();
  });
});

describe("revocarPase", () => {
  it("apunta al pase pedido, no a cualquiera", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const falso = conCliente({
      escritura: { data: [{ id: PASE, revocado_at: "x" }], error: null },
    });

    await revocarPase({ paseId: PASE });

    expect(falso.filtrosDeEscritura).toEqual([["id", PASE]]);
  });

  it("CERO filas no es éxito: la RLS lo escondió sin dar error", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    conCliente({ escritura: { data: [], error: null } });

    expect((await revocarPase({ paseId: PASE })).ok).toBe(false);
  });

  it("si el trigger lo rechaza, se explica en términos del negocio", async () => {
    // Pasa de verdad: el pase pudo vencer entre que se pintó la fila y el clic.
    vi.spyOn(console, "error").mockImplementation(() => {});
    conCliente({
      escritura: {
        data: null,
        error: { message: "solo se revoca un pase vigente" },
      },
    });

    expect(await revocarPase({ paseId: PASE })).toEqual({
      ok: false,
      error: "El pase ya no está vigente",
    });
  });

  it("refresca las dos secciones: el pase se ve desde admin y desde supervisor", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    conCliente({
      escritura: { data: [{ id: PASE, revocado_at: "x" }], error: null },
    });

    await revocarPase({ paseId: PASE });

    expect(revalidados).toEqual(["/admin/acceso", "/supervisor/acceso"]);
  });

  it("rechaza un id que no es uuid antes de tocar la base", async () => {
    const falso = conCliente();
    expect((await revocarPase({ paseId: "../../pase" })).ok).toBe(false);
    expect(falso.tablasPedidas).toEqual([]);
  });
});

describe("guardarCanalesOtp", () => {
  it("añade el correo aunque no venga marcado", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    conCliente({ escritura: { data: [{ id: true }], error: null } });

    await guardarCanalesOtp({ canales: ["sms"] });

    const registrado = JSON.parse(String(info.mock.calls[0]?.[0])) as {
      canales: string[];
    };
    expect(registrado.canales).toEqual(["correo", "sms"]);
  });

  it("un canal que no está en el enum se rechaza", async () => {
    const falso = conCliente();
    expect((await guardarCanalesOtp({ canales: ["paloma"] })).ok).toBe(false);
    expect(falso.tablasPedidas).toEqual([]);
  });

  it("quien no es admin no la cambia: 0 filas, no éxito", async () => {
    conCliente({ escritura: { data: [], error: null } });
    expect((await guardarCanalesOtp({ canales: ["correo"] })).ok).toBe(false);
  });

  it("escribe SOLO sobre la configuración de plataforma", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const falso = conCliente({
      escritura: { data: [{ id: true }], error: null },
    });

    await guardarCanalesOtp({ canales: ["correo", "whatsapp"] });

    expect(falso.tablasPedidas).toEqual(["configuracion_plataforma"]);
  });
});
