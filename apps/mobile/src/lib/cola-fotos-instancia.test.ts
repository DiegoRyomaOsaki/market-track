import { beforeEach, describe, expect, it, jest } from "@jest/globals";

// `encolarFoto` y `reconciliarFotos` son las dos funciones que tocan disco y
// réplica a la vez: mueven el binario, escriben la fila `foto` y reconstruyen el
// manifiesto tras un corte. Se moquean sus dependencias nativas; la cola es la de
// verdad, con su manifiesto en memoria.

const VISITA = "a0000010-0000-0000-0000-000000000001";
const YO = "44444444-4444-4444-4444-444444444444";
const OTRO = "66666666-6666-6666-6666-666666666666";
const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const FOTO = "a0000015-0000-0000-0000-000000000001";

type FilaFoto = {
  id: string;
  visita_id: string;
  hash: string | null;
  capturada_at: string;
  mercaderista_id: string;
};

// `var` a propósito: se iza, así que las fábricas de `jest.mock` —que se evalúan
// antes que las declaraciones del módulo— pueden referenciarlo desde dentro de
// sus funciones sin caer en la zona muerta temporal.
// eslint-disable-next-line no-var
var mockEstado: {
  movidos: { from: string; to: string }[];
  existentes: Set<string>;
  borrados: string[];
  manifiesto: string | null;
  sql: { sql: string; args: unknown[] }[];
  visitas: Record<string, string>;
  fotos: FilaFoto[];
};

jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  getInfoAsync: (ruta: string) =>
    Promise.resolve({
      exists: ruta.endsWith("cola-fotos.json")
        ? mockEstado.manifiesto !== null
        : mockEstado.existentes.has(ruta),
    }),
  readAsStringAsync: () => Promise.resolve(mockEstado.manifiesto ?? "[]"),
  writeAsStringAsync: (_ruta: string, c: string) => {
    mockEstado.manifiesto = c;
    return Promise.resolve();
  },
  moveAsync: ({ from, to }: { from: string; to: string }) => {
    // El renombrado del manifiesto (temporal → definitivo) no es un movimiento de
    // foto: no se cuenta como tal.
    if (!from.endsWith(".tmp")) mockEstado.movidos.push({ from, to });
    mockEstado.existentes.delete(from);
    mockEstado.existentes.add(to);
    return Promise.resolve();
  },
  deleteAsync: (ruta: string) => {
    mockEstado.borrados.push(ruta);
    return Promise.resolve();
  },
  makeDirectoryAsync: () => Promise.resolve(),
  uploadAsync: () => Promise.resolve({ status: 200 }),
}));

jest.mock("expo-crypto", () => ({ randomUUID: () => "generado-por-crypto" }));

jest.mock("./powersync/db", () => ({
  db: {
    currentStatus: { connected: false },
    execute: (s: string, args: unknown[]) => {
      mockEstado.sql.push({ sql: s, args });
      return Promise.resolve();
    },
    getOptional: (s: string, args: unknown[]) => {
      if (!s.includes("FROM visita")) return Promise.resolve(null);
      const id = mockEstado.visitas[String(args[0])];
      return Promise.resolve(id ? { mercaderista_id: id } : null);
    },
    // El doble HONRA la cláusula que la consulta declara, en vez de filtrar por
    // su cuenta: si el código deja de acotar por dueño, aquí llegan todas las
    // filas y el test lo nota. Un doble que filtre siempre da verde igual.
    getAll: (s: string, args: unknown[]) =>
      Promise.resolve(
        s.includes("v.mercaderista_id = ?")
          ? mockEstado.fotos.filter(
              (f) => f.mercaderista_id === String(args[0]),
            )
          : mockEstado.fotos,
      ),
  },
}));

jest.mock("./powersync/estado", () => ({
  contarPendientes: () => Promise.resolve(0),
}));

jest.mock("./supabase", () => ({
  supabase: {
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  },
}));

import {
  colaFotos,
  encolarFoto,
  reconciliarFotos,
  rutaDeFoto,
} from "./cola-fotos-instancia";

beforeEach(() => {
  mockEstado = {
    movidos: [],
    existentes: new Set(),
    borrados: [],
    manifiesto: null,
    sql: [],
    visitas: { [VISITA]: YO },
    fotos: [],
  };
});

const camara = {
  ruta: "file:///cache/ImageManipulator/abc.jpg",
  hash: "sha-1",
  capturada_at: "2026-08-05T12:00:00.000Z",
  geo: { lat: -12.1, lng: -77.03 },
};

describe("encolarFoto", () => {
  it("mueve el binario fuera de la caché, a una ruta derivada del id", async () => {
    // El archivo nace en el directorio de caché, que Android purga: una foto
    // tomada en un sótano y subida días después podría no existir.
    mockEstado.existentes.add(camara.ruta);

    const id = await encolarFoto({
      foto: camara,
      tenantId: TENANT,
      visitaId: VISITA,
      levantamientoId: null,
      tipo: "antes",
      id: FOTO,
    });

    expect(id).toBe(FOTO);
    expect(mockEstado.movidos).toEqual([
      { from: camara.ruta, to: rutaDeFoto(FOTO) },
    ]);
  });

  it("escribe la fila `foto` ANTES de encolar el archivo", async () => {
    mockEstado.existentes.add(camara.ruta);

    await encolarFoto({
      foto: camara,
      tenantId: TENANT,
      visitaId: VISITA,
      levantamientoId: "a0000011-0000-0000-0000-000000000001",
      tipo: "antes",
      id: FOTO,
    });

    const insert = mockEstado.sql[0];
    expect(insert?.sql).toContain("INSERT INTO foto");
    expect(insert?.args[0]).toBe(FOTO);
    expect(insert?.args[2]).toBe(VISITA);
    // Y el manifiesto se escribió después del INSERT.
    expect(await colaFotos.contarPendientes()).toBe(1);
  });

  it("el dueño sale de la VISITA, no de quien llama", async () => {
    mockEstado.visitas = { [VISITA]: OTRO };
    mockEstado.existentes.add(camara.ruta);

    await encolarFoto({
      foto: camara,
      tenantId: TENANT,
      visitaId: VISITA,
      levantamientoId: null,
      tipo: "antes",
      id: FOTO,
    });

    const [p] = await colaFotos.listarPendientes();
    expect(p?.mercaderista_id).toBe(OTRO);
  });

  it("guarda la geo como EWKT, y null cuando el GPS no dio lectura", async () => {
    mockEstado.existentes.add(camara.ruta);
    await encolarFoto({
      foto: { ...camara, geo: null },
      tenantId: TENANT,
      visitaId: VISITA,
      levantamientoId: null,
      tipo: "antes",
      id: FOTO,
    });

    // Nunca `POINT(0 0)`: eso es un punto real en el golfo de Guinea.
    expect(mockEstado.sql[0]?.args[7]).toBeNull();
  });

  it("sin la visita en la réplica falla en vez de encolar algo insubible", async () => {
    mockEstado.visitas = {};
    mockEstado.existentes.add(camara.ruta);

    await expect(
      encolarFoto({
        foto: camara,
        tenantId: TENANT,
        visitaId: VISITA,
        levantamientoId: null,
        tipo: "antes",
        id: FOTO,
      }),
    ).rejects.toThrow(/no está en la réplica/);

    expect(mockEstado.sql).toEqual([]);
    expect(await colaFotos.contarPendientes()).toBe(0);
  });
});

describe("reconciliarFotos", () => {
  it("re-encola una fila sin subir cuyo archivo sigue en disco", async () => {
    // El caso de la app muerta entre escribir la fila y escribir el manifiesto.
    mockEstado.fotos = [
      {
        id: FOTO,
        visita_id: VISITA,
        hash: "sha-1",
        capturada_at: camara.capturada_at,
        mercaderista_id: YO,
      },
    ];
    mockEstado.existentes.add(rutaDeFoto(FOTO));

    expect(await reconciliarFotos(YO)).toBe(1);
    const [p] = await colaFotos.listarPendientes();
    expect(p?.id).toBe(FOTO);
    expect(p?.mercaderista_id).toBe(YO);
  });

  it("no re-encola lo que ya está en el manifiesto", async () => {
    mockEstado.existentes.add(camara.ruta);
    await encolarFoto({
      foto: camara,
      tenantId: TENANT,
      visitaId: VISITA,
      levantamientoId: null,
      tipo: "antes",
      id: FOTO,
    });
    mockEstado.fotos = [
      {
        id: FOTO,
        visita_id: VISITA,
        hash: "sha-1",
        capturada_at: camara.capturada_at,
        mercaderista_id: YO,
      },
    ];

    expect(await reconciliarFotos(YO)).toBe(0);
    expect(await colaFotos.contarPendientes()).toBe(1);
  });

  it("no re-encola una fila cuyo archivo ya no está en disco", async () => {
    mockEstado.fotos = [
      {
        id: FOTO,
        visita_id: VISITA,
        hash: null,
        capturada_at: camara.capturada_at,
        mercaderista_id: YO,
      },
    ];

    expect(await reconciliarFotos(YO)).toBe(0);
    expect(await colaFotos.contarPendientes()).toBe(0);
  });

  it("no toca las fotos de OTRO mercaderista del mismo teléfono", async () => {
    // Estampar el usuario actual sobre lo ajeno anularía el filtro del subidor.
    mockEstado.fotos = [
      {
        id: FOTO,
        visita_id: VISITA,
        hash: "sha-1",
        capturada_at: camara.capturada_at,
        mercaderista_id: OTRO,
      },
    ];
    mockEstado.existentes.add(rutaDeFoto(FOTO));

    expect(await reconciliarFotos(YO)).toBe(0);
    expect(await colaFotos.contarPendientes()).toBe(0);
  });
});
