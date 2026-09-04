import { beforeEach, describe, expect, it, jest } from "@jest/globals";

// `marcarModuloHecho` en un fichero aparte porque necesita moquear la réplica, y
// `progreso-visita.test.ts` prueba la lógica pura con mocks vacíos: mezclarlos
// dejaría un fichero donde la mitad de los mocks mienten sobre lo que hace la
// otra mitad.
//
// Lo que se prueba aquí es la verja que cuenta EN EL TELÉFONO. Postgres impide
// el módulo duplicado con dos índices únicos parciales, pero PowerSync no
// replica constraints al SQLite local: en campo, sin señal, lo único que hay
// entre el mercaderista y una fila duplicada es esta consulta.

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const LEV = "a0000011-0000-0000-0000-000000000001";

type FilaModulo = {
  id: string;
  levantamiento_id: string;
  paso: string;
  paso_config_id: string | null;
};

// `var` a propósito: se iza, así que las fábricas de `jest.mock` —evaluadas
// antes que las declaraciones del módulo— pueden referenciarlo.
// eslint-disable-next-line no-var
var mockEstado: { modulos: FilaModulo[]; siguienteId: number };

jest.mock("expo-crypto", () => ({
  randomUUID: () => `mod-${++mockEstado.siguienteId}`,
}));

jest.mock("@powersync/react-native", () => ({ useQuery: jest.fn() }));

jest.mock("./powersync/db", () => ({
  db: {
    getAll: (_sql: string, args: unknown[]) => {
      const [lev, paso, , configId] = args as [
        string,
        string,
        string | null,
        string | null,
      ];
      return Promise.resolve(
        mockEstado.modulos.filter(
          (m) =>
            m.levantamiento_id === lev &&
            m.paso === paso &&
            m.paso_config_id === configId,
        ),
      );
    },
    execute: (_sql: string, args: unknown[]) => {
      const [id, , lev, paso, configId] = args as [
        string,
        string,
        string,
        string,
        string | null,
      ];
      mockEstado.modulos.push({
        id,
        levantamiento_id: lev,
        paso,
        paso_config_id: configId,
      });
      return Promise.resolve();
    },
  },
}));

import { marcarModuloHecho } from "./progreso-visita";

const cerrar = (paso: string, pasoConfigId: string | null = null) =>
  marcarModuloHecho({
    tenant_id: TENANT,
    levantamiento_id: LEV,
    paso,
    paso_config_id: pasoConfigId,
  });

beforeEach(() => {
  mockEstado = { modulos: [], siguienteId: 0 };
});

describe("marcarModuloHecho", () => {
  it("escribe la fila del módulo cerrado", async () => {
    await cerrar("quiebres");

    expect(mockEstado.modulos).toEqual([
      {
        id: "mod-1",
        levantamiento_id: LEV,
        paso: "quiebres",
        paso_config_id: null,
      },
    ]);
  });

  it("cerrar dos veces el mismo módulo no duplica la fila", async () => {
    // Con navegación libre el mercaderista puede reabrir un módulo ya cerrado y
    // volver a pulsar "Continuar". En el teléfono no hay índice único que lo
    // pare: lo para esta guarda.
    await cerrar("quiebres");
    await cerrar("quiebres");

    expect(mockEstado.modulos).toHaveLength(1);
  });

  it("dos módulos fijos distintos sí son dos filas", async () => {
    await cerrar("quiebres");
    await cerrar("precios");

    expect(mockEstado.modulos.map((m) => m.paso)).toEqual([
      "quiebres",
      "precios",
    ]);
  });

  it("dos configurables distintos son dos filas pese a compartir el enum", async () => {
    // Todos los pasos configurables llevan `campos_extra`: si la guarda mirase
    // solo el enum, cerrar el primero daría por cerrados todos los demás.
    await cerrar("campos_extra", "extra_uno");
    await cerrar("campos_extra", "extra_dos");

    expect(mockEstado.modulos.map((m) => m.paso_config_id)).toEqual([
      "extra_uno",
      "extra_dos",
    ]);
  });

  it("el mismo configurable dos veces sigue siendo una fila", async () => {
    await cerrar("campos_extra", "extra_uno");
    await cerrar("campos_extra", "extra_uno");

    expect(mockEstado.modulos).toHaveLength(1);
  });
});
