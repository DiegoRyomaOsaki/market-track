import { beforeEach, describe, expect, it, jest } from "@jest/globals";

// `crearLevantamiento` es la única función de este módulo con una invariante que
// la base NO puede defender en el teléfono: `levantamiento` tiene
// `unique (visita_id, marca_id)` en Postgres, pero PowerSync no replica
// constraints al SQLite local. Si la app crea dos, los dos entran localmente y
// el servidor rechaza uno con 23505 al sincronizar — un error que el conector
// clasifica como permanente y DESCARTA, llevándose lo que colgase de él.
//
// Con la navegación libre esto deja de ser hipotético: el mercaderista abre los
// módulos de una marca en el orden que quiera, así que la función se llama
// varias veces para la misma `(visita, marca)`.

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const VISITA = "a0000010-0000-0000-0000-000000000001";
const MARCA = "cccccccc-0000-0000-0000-000000000001";

type FilaLevantamiento = {
  id: string;
  visita_id: string;
  marca_id: string;
};

// `var` a propósito: se iza, así que las fábricas de `jest.mock` —evaluadas
// antes que las declaraciones del módulo— pueden referenciarlo sin caer en la
// zona muerta temporal.
// eslint-disable-next-line no-var
var mockEstado: {
  levantamientos: FilaLevantamiento[];
  siguienteId: number;
};

jest.mock("expo-crypto", () => ({
  randomUUID: () => `nuevo-${++mockEstado.siguienteId}`,
}));

jest.mock("@powersync/react-native", () => ({
  useQuery: () => ({ data: [], isLoading: false }),
}));

jest.mock("./powersync/db", () => ({
  db: {
    getAll: (sql: string, args: unknown[]) => {
      if (sql.includes("FROM levantamiento")) {
        const [visita, marca] = args as [string, string];
        return Promise.resolve(
          mockEstado.levantamientos
            .filter((l) => l.visita_id === visita && l.marca_id === marca)
            .map((l) => ({ id: l.id })),
        );
      }
      // El maestro de formularios: sin formulario configurable, el levantamiento
      // se ancla a null y el wizard usa solo los pasos fijos.
      return Promise.resolve([]);
    },
    execute: (sql: string, args: unknown[]) => {
      if (sql.includes("INSERT INTO levantamiento")) {
        const [id, , visita, marca] = args as [
          string,
          string,
          string,
          string,
          string | null,
        ];
        // El `WHERE NOT EXISTS` del SQL real, aquí a mano: sin él, el fake sería
        // más permisivo que SQLite y el test pasaría con la función rota.
        const yaHay = mockEstado.levantamientos.some(
          (l) => l.visita_id === visita && l.marca_id === marca,
        );
        if (!yaHay) {
          mockEstado.levantamientos.push({
            id,
            visita_id: visita,
            marca_id: marca,
          });
        }
      }
      return Promise.resolve();
    },
  },
}));

import { crearLevantamiento } from "./levantamiento";

beforeEach(() => {
  mockEstado = { levantamientos: [], siguienteId: 0 };
});

describe("crearLevantamiento", () => {
  it("crea el levantamiento de una marca y devuelve su id", async () => {
    const id = await crearLevantamiento({
      tenant_id: TENANT,
      visita_id: VISITA,
      marca_id: MARCA,
    });
    expect(id).toBe("nuevo-1");
    expect(mockEstado.levantamientos).toHaveLength(1);
  });

  it("llamarla dos veces para la misma marca devuelve el MISMO id", async () => {
    // El caso que la navegación libre vuelve cotidiano: abrir dos módulos de la
    // misma marca son dos montajes, y cada uno pide su levantamiento.
    const primero = await crearLevantamiento({
      tenant_id: TENANT,
      visita_id: VISITA,
      marca_id: MARCA,
    });
    const segundo = await crearLevantamiento({
      tenant_id: TENANT,
      visita_id: VISITA,
      marca_id: MARCA,
    });
    expect(segundo).toBe(primero);
    expect(mockEstado.levantamientos).toHaveLength(1);
  });

  it("dos marcas distintas de la misma visita sí son dos levantamientos", async () => {
    const otraMarca = "cccccccc-0000-0000-0000-000000000002";
    const uno = await crearLevantamiento({
      tenant_id: TENANT,
      visita_id: VISITA,
      marca_id: MARCA,
    });
    const dos = await crearLevantamiento({
      tenant_id: TENANT,
      visita_id: VISITA,
      marca_id: otraMarca,
    });
    expect(dos).not.toBe(uno);
    expect(mockEstado.levantamientos).toHaveLength(2);
  });

  it("si el INSERT no escribe nada y no hay fila, falla en vez de devolver un id fantasma", async () => {
    // Devolver el uuid recién generado a ciegas dejaría al mercaderista
    // capturando contra un levantamiento que no existe y que el servidor nunca
    // aceptará: el trabajo de esa marca se perdería en silencio.
    mockEstado.levantamientos = [];
    const dbMock = jest.requireMock<{
      db: { execute: (sql: string, args: unknown[]) => Promise<void> };
    }>("./powersync/db");
    const original = dbMock.db.execute;
    dbMock.db.execute = () => Promise.resolve();
    await expect(
      crearLevantamiento({
        tenant_id: TENANT,
        visita_id: VISITA,
        marca_id: MARCA,
      }),
    ).rejects.toThrow(/levantamiento/);
    dbMock.db.execute = original;
  });
});
