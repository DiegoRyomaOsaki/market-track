import { beforeEach, describe, expect, it, jest } from "@jest/globals";

// db.ts crea un PowerSyncDatabase real (op-sqlite nativo): se moquea a lo que
// contarPendientes consume — el conteo de la cola de subida.
jest.mock("./db", () => ({
  db: { getUploadQueueStats: jest.fn() },
}));

import { db } from "./db";

import { contarPendientes } from "./estado";

// jest.mocked sobre un método del mock no arrastra `this` (es un jest.fn()):
// el aviso unbound-method es un falso positivo.
// eslint-disable-next-line @typescript-eslint/unbound-method
const mockStats = jest.mocked(db.getUploadQueueStats);

beforeEach(() => {
  jest.clearAllMocks();
});

// El test del hook useEstadoSync (listener, cleanup, fallback a 0) queda
// pendiente de una infra de testing con React 19: @testing-library/react-native
// v14 aún depende de react-test-renderer, que no soporta act(...) bajo React 19.
// Aquí se cubre la lógica de conteo, que es lo que alimenta al indicador.

describe("contarPendientes", () => {
  it("devuelve el número de ops pendientes de la cola de subida", async () => {
    mockStats.mockResolvedValue({ count: 7, size: null });
    expect(await contarPendientes()).toBe(7);
  });

  it("cola vacía: devuelve 0", async () => {
    mockStats.mockResolvedValue({ count: 0, size: null });
    expect(await contarPendientes()).toBe(0);
  });

  it("propaga el fallo (no lo traga): el hook decide qué mostrar", async () => {
    // Que lance es el contrato del que depende el .catch del hook para avisar por
    // log en vez de mostrar un "0 pendientes" silencioso.
    mockStats.mockRejectedValue(new Error("db cerrada"));
    await expect(contarPendientes()).rejects.toThrow("db cerrada");
  });
});
