import { describe, expect, it } from "@jest/globals";

import { CASOS_PRECIO, ORIGENES_INCIDENCIA } from "@market-track/shared";

import {
  DERIVABLE_EN_LOCAL,
  deltaDiferencia,
  esDiferencia,
  esQuiebre,
  evaluarPrecio,
  hallazgosDeExhibicion,
  hallazgosDeSku,
  NO_DERIVABLE_EN_LOCAL,
} from "./hallazgos";

describe("esQuiebre", () => {
  it("es quiebre con sistema > 0 y piso 0", () => {
    expect(esQuiebre(5, 0)).toBe(true);
  });

  it("no es quiebre si hay stock en piso", () => {
    expect(esQuiebre(5, 2)).toBe(false);
  });

  it("no es quiebre si el sistema también está en 0", () => {
    expect(esQuiebre(0, 0)).toBe(false);
  });
});

describe("esDiferencia", () => {
  it("es diferencia con piso > 0 y piso ≠ sistema", () => {
    expect(esDiferencia(5, 3)).toBe(true);
  });

  it("no es diferencia cuando piso iguala al sistema", () => {
    expect(esDiferencia(5, 5)).toBe(false);
  });

  it("no es diferencia con piso 0 (eso es quiebre)", () => {
    expect(esDiferencia(5, 0)).toBe(false);
  });
});

describe("quiebre y diferencia son excluyentes", () => {
  it("nunca son ambos verdaderos", () => {
    for (const sistema of [0, 1, 5]) {
      for (const piso of [0, 1, 5]) {
        expect(esQuiebre(sistema, piso) && esDiferencia(sistema, piso)).toBe(
          false,
        );
      }
    }
  });
});

describe("deltaDiferencia", () => {
  it("es piso menos sistema", () => {
    expect(deltaDiferencia(5, 3)).toBe(-2);
    expect(deltaDiferencia(3, 5)).toBe(2);
  });
});

describe("el espejo del árbol de precio coincide con el de la base", () => {
  // El corpus es el MISMO fichero que ejecuta `alertas.db.test.ts` contra
  // `app.evaluar_precio_sku`. Es la única verja real contra la divergencia: si
  // el SQL cambia y esto no, uno de los dos lados se pone rojo. Ver docs/adr/0012.
  it.each(CASOS_PRECIO.map((c) => [c.nombre, c] as const))(
    "%s",
    (_nombre, caso) => {
      const r = evaluarPrecio({
        precioRegistrado: caso.precio_registrado,
        hayPromo: caso.hay_promo,
        promoComunicada: caso.promo_comunicada,
        toleranciaPct: caso.tolerancia_pct,
        periodos: caso.periodos,
        promociones: caso.promociones,
        fecha: caso.fecha,
      });
      expect(r.veredicto).toBe(caso.espera);
      expect(r.precioRegular).toBe(caso.esperaRegular);
    },
  );
});

describe("hallazgosDeSku", () => {
  const CONTEXTO = {
    toleranciaPct: 5,
    periodos: [
      {
        precio: 10,
        vigente_desde: "2026-01-01",
        vigente_hasta: null,
        tipo_tienda: null,
      },
    ],
    promociones: [],
    fecha: "2026-06-15",
  };

  const FILA = {
    levantamiento_id: "lev-1",
    sku_id: "sku-1",
    stock_sistema: null,
    stock_piso: null,
    precio_registrado: null,
    hay_promo: null,
    promo_comunicada: null,
  };

  it("un quiebre sale con los números que se van a pintar", () => {
    const h = hallazgosDeSku(
      { ...FILA, stock_sistema: 10, stock_piso: 0 },
      CONTEXTO,
    );
    expect(h.map((x) => x.origen)).toEqual(["quiebre"]);
    expect(h[0]?.detalle).toMatchObject({ stock_sistema: 10, stock_piso: 0 });
    expect(h[0]?.skuId).toBe("sku-1");
  });

  it("una diferencia lleva su delta", () => {
    const h = hallazgosDeSku(
      { ...FILA, stock_sistema: 5, stock_piso: 3 },
      CONTEXTO,
    );
    expect(h.map((x) => x.origen)).toEqual(["diferencia_stock"]);
    expect(h[0]?.detalle).toMatchObject({ delta: -2 });
  });

  it("`stock_piso` NULO no es cero: la fila del paso SOS no inventa un quiebre", () => {
    // Es el borde que dejó mudo al motor cuando su trigger miraba solo el
    // INSERT. Tratarlo como cero pondría un quiebre en cada SKU nada más abrir
    // el módulo, y la verja de check-out sería impasable.
    expect(hallazgosDeSku({ ...FILA, stock_sistema: 10 }, CONTEXTO)).toEqual(
      [],
    );
  });

  it("un sobreprecio y un quiebre salen los DOS de la misma fila", () => {
    const h = hallazgosDeSku(
      {
        ...FILA,
        stock_sistema: 10,
        stock_piso: 0,
        precio_registrado: 20,
      },
      CONTEXTO,
    );
    expect(h.map((x) => x.origen)).toEqual(["quiebre", "desviacion_precio"]);
  });

  it("una fila sin nada levantado no produce hallazgos", () => {
    expect(hallazgosDeSku(FILA, CONTEXTO)).toEqual([]);
  });
});

describe("hallazgosDeExhibicion", () => {
  const FILA = {
    levantamiento_id: "lev-1",
    exhibicion_negociada_id: "exh-1",
    instalada: 0,
    unidades: 0,
  };

  it("una exhibición negociada NO instalada es un hallazgo", () => {
    const h = hallazgosDeExhibicion(FILA);
    expect(h.map((x) => x.origen)).toEqual(["exhibicion_no_instalada"]);
    expect(h[0]?.exhibicionNegociadaId).toBe("exh-1");
    expect(h[0]?.skuId).toBeNull();
  });

  it("instalada no lo es", () => {
    expect(hallazgosDeExhibicion({ ...FILA, instalada: 1 })).toEqual([]);
  });

  it("una exhibición que no estaba negociada tampoco: no había nada que cumplir", () => {
    expect(
      hallazgosDeExhibicion({ ...FILA, exhibicion_negociada_id: null }),
    ).toEqual([]);
  });

  it("`instalada` sin responder todavía no es un incumplimiento", () => {
    expect(hallazgosDeExhibicion({ ...FILA, instalada: null })).toEqual([]);
  });
});

describe("DERIVABLE_EN_LOCAL", () => {
  it("dice algo de CADA origen del enum", () => {
    // El mapa es exhaustivo por tipo, pero esto fija que ninguno se quede sin
    // decisión consciente: la verja subcontaría en silencio.
    for (const origen of ORIGENES_INCIDENCIA) {
      expect(DERIVABLE_EN_LOCAL[origen]).toBeDefined();
    }
  });

  it("el planograma NO se deriva en local, y está dicho", () => {
    // Nada lo crea todavía, ni en el servidor ni aquí.
    expect(DERIVABLE_EN_LOCAL.incumplimiento_planograma).toBe(
      NO_DERIVABLE_EN_LOCAL,
    );
  });
});
