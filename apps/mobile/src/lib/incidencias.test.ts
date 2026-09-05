import { describe, expect, it, jest } from "@jest/globals";
import { ORIGENES_INCIDENCIA } from "@market-track/shared";

// La lógica pura de la lista de incidencias. Vive junto a los hooks que leen la
// réplica y a la escritura de la resolución, así que se moquean sus dependencias
// nativas para que Jest pueda cargar el módulo; ninguna participa aquí.
jest.mock("@powersync/react-native", () => ({ useQuery: jest.fn() }));
jest.mock("./powersync/db", () => ({ db: {} }));
jest.mock("./cola-fotos-instancia", () => ({ encolarFoto: jest.fn() }));

import {
  agruparPorMarca,
  unirHallazgos,
  contarPendientes,
  describirIncidencia,
  ETIQUETA_ESTADO,
  type IncidenciaLocal,
} from "./incidencias";

const incidencia = (p: Partial<IncidenciaLocal> = {}): IncidenciaLocal => ({
  id: "i1",
  visita_id: "v1",
  levantamiento_id: "lev-oster",
  marca_id: "m1",
  marca_nombre: "Oster",
  sku_nombre: "Licuadora X",
  origen: "quiebre",
  estado: "pendiente",
  detalle: null,
  accion_tomada: null,
  motivo: null,
  creado_at: "2026-09-04T12:00:00.000Z",
  sku_id: null,
  exhibicion_negociada_id: null,
  derivada: false,
  atendidaSinSincronizar: false,
  ...p,
});

describe("describirIncidencia", () => {
  // Un mapa sobre un enum se prueba con TODOS sus valores: una rama sin cubrir
  // es un texto que nadie vio hasta que un mercaderista se lo encontró.
  it.each(ORIGENES_INCIDENCIA)(
    "describe el origen %s sin reventar",
    (origen) => {
      const texto = describirIncidencia(origen, null);
      expect(texto.length).toBeGreaterThan(0);
    },
  );

  it("usa los números que el motor guardó, no los recalcula", () => {
    const texto = describirIncidencia(
      "quiebre",
      JSON.stringify({ stock_sistema: 20, stock_piso: 0 }),
    );
    expect(texto).toContain("20");
  });

  it("una diferencia dice los dos lados", () => {
    const texto = describirIncidencia(
      "diferencia_stock",
      JSON.stringify({ stock_sistema: 10, stock_piso: 7 }),
    );
    expect(texto).toContain("10");
    expect(texto).toContain("7");
  });

  it("un precio dice el registrado y el regular", () => {
    const texto = describirIncidencia(
      "desviacion_precio",
      JSON.stringify({ precio_registrado: 8.9, precio_regular: 6.9 }),
    );
    expect(texto).toContain("8.9");
    expect(texto).toContain("6.9");
  });

  // El detalle llega a SQLite como texto y el motor puede cambiarlo. Ni un texto
  // roto ni uno vacío pueden tumbar la lista entera.
  it("un detalle roto no revienta: cae al texto genérico", () => {
    expect(describirIncidencia("quiebre", "{ esto no es json")).toContain(
      "Quiebre",
    );
  });

  it("un detalle sin las claves esperadas tampoco", () => {
    expect(
      describirIncidencia("desviacion_precio", JSON.stringify({ otra: 1 })),
    ).toContain("precio");
  });
});

describe("contarPendientes", () => {
  it("cuenta solo las pendientes", () => {
    expect(
      contarPendientes([
        incidencia({ estado: "pendiente" }),
        incidencia({ estado: "pendiente" }),
        incidencia({ estado: "resuelta" }),
      ]),
    ).toBe(2);
  });

  // Ya fue atendida: el mercaderista la miró y dijo por qué no pudo. Contarla
  // como pendiente le pediría atenderla otra vez.
  it("una atendida con observación NO cuenta como pendiente", () => {
    expect(contarPendientes([incidencia({ estado: "no_resuelta" })])).toBe(0);
  });

  it("sin incidencias, cero", () => {
    expect(contarPendientes([])).toBe(0);
  });
});

describe("agruparPorMarca", () => {
  it("agrupa por marca y ordena los grupos por nombre", () => {
    const grupos = agruparPorMarca([
      incidencia({ id: "b", marca_id: "m2", marca_nombre: "Sharpie" }),
      incidencia({ id: "a", marca_id: "m1", marca_nombre: "Oster" }),
    ]);
    expect(grupos.map((g) => g.marcaNombre)).toEqual(["Oster", "Sharpie"]);
  });

  it("dentro de cada marca, las pendientes van primero", () => {
    const grupos = agruparPorMarca([
      incidencia({ id: "hecha", estado: "resuelta" }),
      incidencia({ id: "falta", estado: "pendiente" }),
    ]);
    expect(grupos[0]?.incidencias.map((i) => i.id)).toEqual(["falta", "hecha"]);
  });

  it("una incidencia sin marca cae en su propio grupo, al final", () => {
    // No puede mezclarse con la de otra marca: diría que el hallazgo es de una
    // marca que no lo tuvo.
    const grupos = agruparPorMarca([
      incidencia({ id: "sin", marca_id: null, marca_nombre: null }),
      incidencia({ id: "con", marca_id: "m1", marca_nombre: "Oster" }),
    ]);
    expect(grupos.map((g) => g.marcaId)).toEqual(["m1", null]);
    expect(grupos[1]?.marcaNombre).toBe("Sin marca");
  });

  it("sin incidencias no hay grupos", () => {
    expect(agruparPorMarca([])).toEqual([]);
  });
});

describe("ETIQUETA_ESTADO", () => {
  it("da texto a cada estado, para que el color no sea la única señal", () => {
    for (const estado of [
      "pendiente",
      "resuelta",
      "no_resuelta",
      "anulada",
    ] as const) {
      expect(ETIQUETA_ESTADO[estado].length).toBeGreaterThan(0);
    }
  });

  it("distingue «atendida con observación» de «resuelta»", () => {
    // Son dos cosas distintas y la lista tiene que dejarlo claro: una se
    // resolvió, la otra se miró y no se pudo.
    expect(ETIQUETA_ESTADO.no_resuelta).not.toBe(ETIQUETA_ESTADO.resuelta);
  });
});

describe("unirHallazgos", () => {
  const clave = {
    levantamiento_id: "lev-oster",
    sku_id: "sku-1",
    exhibicion_negociada_id: null,
    origen: "quiebre" as const,
  };
  const delServidor = incidencia({ id: "srv", ...clave });
  const derivado = incidencia({ id: "derivada:…", derivada: true, ...clave });

  it("el mismo hallazgo por los dos lados sale UNA vez", () => {
    // Un duplicado deja la verja de check-out IMPOSIBLE de despejar, que es peor
    // que no tenerla.
    const r = unirHallazgos([delServidor], [derivado], []);
    expect(r).toHaveLength(1);
    expect(r[0]?.id).toBe("srv");
  });

  it("cuando la fila del servidor existe, MANDA ella", () => {
    const r = unirHallazgos([delServidor], [derivado], []);
    expect(r[0]?.derivada).toBe(false);
  });

  it("sin fila del servidor, el derivado rellena el hueco", () => {
    const r = unirHallazgos([], [derivado], []);
    expect(r).toHaveLength(1);
    expect(r[0]?.derivada).toBe(true);
  });

  it("dos orígenes del MISMO sku no se pisan", () => {
    const otro = incidencia({
      id: "d2",
      derivada: true,
      ...clave,
      origen: "desviacion_precio",
    });
    expect(unirHallazgos([], [derivado, otro], [])).toHaveLength(2);
  });

  it("el mismo origen de dos SKU distintos tampoco", () => {
    const otro = incidencia({
      id: "d2",
      derivada: true,
      ...clave,
      sku_id: "sku-2",
    });
    expect(unirHallazgos([], [derivado, otro], [])).toHaveLength(2);
  });

  it("una atención declarada sin sincronizar marca el hallazgo como atendido", () => {
    const r = unirHallazgos([], [derivado], [clave]);
    expect(r[0]?.atendidaSinSincronizar).toBe(true);
  });

  it("y entonces DEJA de contar como pendiente: si no, la verja sería impasable", () => {
    // El mercaderista ya hizo su parte; seguir contándola lo dejaría encerrado en
    // la tienda hasta que hubiera señal.
    expect(contarPendientes(unirHallazgos([], [derivado], [clave]))).toBe(0);
    expect(contarPendientes(unirHallazgos([], [derivado], []))).toBe(1);
  });
});
