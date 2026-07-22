import { beforeEach, describe, expect, it, jest } from "@jest/globals";

// @powersync/react-native arrastra módulos nativos (op-sqlite) que no cargan
// fuera del dispositivo: se moquea al solo enum que el conector usa en runtime.
// Los demás imports del conector desde ese paquete son de tipos (se borran).
jest.mock("@powersync/react-native", () => ({
  UpdateType: { PUT: "PUT", PATCH: "PATCH", DELETE: "DELETE" },
}));

// Los jest.fn() van DENTRO de la factory (jest la hoistea sobre los consts, así
// que capturar variables externas daría undefined). Se toma la referencia con
// jest.mocked tras el import.
jest.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: jest.fn() }, from: jest.fn() },
}));

jest.mock("@/lib/env", () => ({ env: { POWERSYNC_URL: "http://ps.test" } }));

import { UpdateType } from "@powersync/react-native";

import { env } from "@/lib/env";
import { supabase } from "@/lib/supabase";

import { ConectorSupabase } from "./conector";

// jest.mocked sobre un método del mock no arrastra `this` (es un jest.fn()):
// el aviso unbound-method es un falso positivo.
/* eslint-disable @typescript-eslint/unbound-method */
const mockGetSession = jest.mocked(supabase.auth.getSession);
const mockFrom = jest.mocked(supabase.from);
/* eslint-enable @typescript-eslint/unbound-method */

// Un builder de PostgREST de mentira: cada verbo resuelve a `{ error }`. update y
// delete encadenan `.eq(...)`, como el cliente real.
function tablaFalsa(error: unknown = null) {
  const resultado = Promise.resolve({ error });
  return {
    upsert: jest.fn(() => resultado),
    update: jest.fn(() => ({ eq: jest.fn(() => resultado) })),
    delete: jest.fn(() => ({ eq: jest.fn(() => resultado) })),
  };
}

// Una transacción CRUD de mentira con su `complete` espiable.
function txFalsa(crud: unknown[]) {
  const complete = jest.fn(() => Promise.resolve());
  const base = {
    getNextCrudTransaction: jest.fn(() => Promise.resolve({ crud, complete })),
  };
  return { base, complete };
}

const op = (tipo: string, extra: Record<string, unknown> = {}) => ({
  op: tipo,
  table: "visita",
  id: "v1",
  opData: { nombre: "x" },
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  env.POWERSYNC_URL = "http://ps.test";
});

describe("fetchCredentials", () => {
  it("sin POWERSYNC_URL no sincroniza ni pide sesión", async () => {
    env.POWERSYNC_URL = undefined;
    const cred = await new ConectorSupabase().fetchCredentials();
    expect(cred).toBeNull();
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it("sin sesión no sincroniza", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } } as never);
    expect(await new ConectorSupabase().fetchCredentials()).toBeNull();
  });

  it("con endpoint y sesión devuelve endpoint + token", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "jwt-123" } },
    } as never);
    expect(await new ConectorSupabase().fetchCredentials()).toEqual({
      endpoint: "http://ps.test",
      token: "jwt-123",
    });
  });
});

describe("uploadData", () => {
  it("cola vacía: no toca el backend ni falla", async () => {
    const { base, complete } = txFalsa([]);
    await new ConectorSupabase().uploadData(base as never);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("nada que subir (transacción null): retorna sin tocar el backend", async () => {
    const base = {
      getNextCrudTransaction: jest.fn(() => Promise.resolve(null)),
    };
    await new ConectorSupabase().uploadData(base as never);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("PUT hace upsert con el id incluido", async () => {
    const tabla = tablaFalsa();
    mockFrom.mockReturnValue(tabla as never);
    const { base, complete } = txFalsa([op(UpdateType.PUT)]);
    await new ConectorSupabase().uploadData(base as never);
    expect(mockFrom).toHaveBeenCalledWith("visita");
    expect(tabla.upsert).toHaveBeenCalledWith({ nombre: "x", id: "v1" });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("PATCH actualiza filtrando por id", async () => {
    const tabla = tablaFalsa();
    mockFrom.mockReturnValue(tabla as never);
    const { base, complete } = txFalsa([op(UpdateType.PATCH)]);
    await new ConectorSupabase().uploadData(base as never);
    expect(tabla.update).toHaveBeenCalledWith({ nombre: "x" });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("DELETE borra filtrando por id", async () => {
    const tabla = tablaFalsa();
    mockFrom.mockReturnValue(tabla as never);
    const { base, complete } = txFalsa([op(UpdateType.DELETE)]);
    await new ConectorSupabase().uploadData(base as never);
    expect(tabla.delete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("rechazo PERMANENTE (SQLSTATE): descarta la op y completa la transacción", async () => {
    // Una op que la RLS rechaza (42501) no debe bloquear la cola: se descarta y
    // el lote se da por completado para que lo de atrás pueda subir.
    const tabla = tablaFalsa({ code: "42501", message: "permission denied" });
    mockFrom.mockReturnValue(tabla as never);
    const { base, complete } = txFalsa([op(UpdateType.PUT)]);
    const espia = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      new ConectorSupabase().uploadData(base as never),
    ).resolves.toBeUndefined();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(espia).toHaveBeenCalledTimes(1);
    espia.mockRestore();
  });

  it("fallo TRANSITORIO (sin SQLSTATE): relanza y NO completa, para reintentar", async () => {
    // Un fallo de red no trae SQLSTATE: se relanza sin completar, y PowerSync
    // reintenta el mismo lote.
    const tabla = tablaFalsa({ message: "Network request failed" });
    mockFrom.mockReturnValue(tabla as never);
    const { base, complete } = txFalsa([op(UpdateType.PUT)]);

    await expect(
      new ConectorSupabase().uploadData(base as never),
    ).rejects.toBeDefined();
    expect(complete).not.toHaveBeenCalled();
  });
});
