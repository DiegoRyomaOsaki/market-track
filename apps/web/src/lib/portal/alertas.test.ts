import {
  ESTADOS_ALERTA,
  SEVERIDADES_ALERTA,
  TIPOS_ALERTA,
} from "@market-track/shared";
import { describe, expect, it } from "vitest";

import {
  accionesDeEstado,
  ESTILO_ESTADO,
  ESTILO_SEVERIDAD,
  ETIQUETA_ESTADO,
  ETIQUETA_SEVERIDAD,
  ETIQUETA_TIPO_ALERTA,
  filasDeEvidencia,
  rotuloDeFoto,
} from "./alertas";

const SKU = "a0000003-0000-0000-0000-000000000001";

describe("las etiquetas y los tonos", () => {
  it("cubren todos los valores de los tres enums", () => {
    // Si el enum crece, el Record deja de compilar; esto además lo comprueba en
    // ejecución por si alguien lo ensancha con un índice suelto.
    for (const t of TIPOS_ALERTA) expect(ETIQUETA_TIPO_ALERTA[t]).toBeTruthy();
    for (const s of SEVERIDADES_ALERTA) {
      expect(ETIQUETA_SEVERIDAD[s]).toBeTruthy();
      expect(ESTILO_SEVERIDAD[s]).toBeTruthy();
    }
    for (const e of ESTADOS_ALERTA) {
      expect(ETIQUETA_ESTADO[e]).toBeTruthy();
      expect(ESTILO_ESTADO[e]).toBeTruthy();
    }
  });

  it("los tonos salen de los tokens del tema, nunca de un color crudo", () => {
    // Un hex aquí se vería mal en modo oscuro y no lo detectaría ningún test de
    // render.
    for (const clase of [
      ...Object.values(ESTILO_SEVERIDAD),
      ...Object.values(ESTILO_ESTADO),
    ]) {
      expect(clase).not.toMatch(/#[0-9a-f]{3,}/i);
    }
  });
});

describe("filasDeEvidencia", () => {
  it("el quiebre enfrenta sistema contra piso", () => {
    const filas = filasDeEvidencia("quiebre", {
      sku_id: SKU,
      stock_sistema: 20,
      stock_piso: 0,
    });
    expect(filas).toEqual([
      { etiqueta: "Stock en sistema", valor: "20" },
      { etiqueta: "Stock en piso", valor: "0" },
    ]);
  });

  it("la diferencia añade el delta con su signo", () => {
    const filas = filasDeEvidencia("diferencia_stock", {
      sku_id: SKU,
      stock_sistema: 20,
      stock_piso: 14,
      delta: -6,
    });
    expect(filas.at(-1)).toEqual({ etiqueta: "Diferencia", valor: "-6" });
  });

  it("el delta positivo se marca como tal: sobra stock, no falta", () => {
    const filas = filasDeEvidencia("diferencia_stock", {
      sku_id: SKU,
      stock_sistema: 10,
      stock_piso: 14,
      delta: 4,
    });
    expect(filas.at(-1)?.valor).toBe("+4");
  });

  it("un stock sin contar sale como «—», no como 0", () => {
    // 0 significa "no queda nada"; null, "no se contó". Confundirlos convierte
    // una casilla vacía en un quiebre.
    const filas = filasDeEvidencia("quiebre", {
      sku_id: SKU,
      stock_sistema: null,
      stock_piso: null,
    });
    expect(filas.map((f) => f.valor)).toEqual(["—", "—"]);
  });

  it("el precio enseña el esperado Y el registrado, en soles", () => {
    const filas = filasDeEvidencia("desviacion_precio", {
      sku_id: SKU,
      precio_registrado: 12.9,
      precio_regular: 9.9,
      motivo: "sobreprecio",
    });
    expect(filas[0]?.etiqueta).toBe("Precio esperado");
    expect(filas[0]?.valor).toContain("9.90");
    expect(filas[1]?.etiqueta).toBe("Precio registrado");
    expect(filas[1]?.valor).toContain("12.90");
  });

  it("traduce el motivo del árbol de precios, no lo enseña en crudo", () => {
    const filas = filasDeEvidencia("desviacion_precio", {
      sku_id: SKU,
      precio_registrado: 7.5,
      precio_regular: 9.9,
      motivo: "subvaluado_sin_promo",
    });
    expect(filas.at(-1)?.valor).toMatch(/sin promoción/);
    expect(filas.at(-1)?.valor).not.toContain("_");
  });

  it("la contingencia dice qué paso se omitió y por qué", () => {
    const filas = filasDeEvidencia("contingencia", {
      paso: "precios",
      motivo: "Góndola en remodelación",
    });
    expect(filas).toEqual([
      { etiqueta: "Paso omitido", valor: "precios" },
      { etiqueta: "Motivo", valor: "Góndola en remodelación" },
    ]);
  });

  it("un payload que no encaja se DICE, no se pinta a medias", () => {
    // El payload es un jsonb sin forma declarada: si una migración del motor lo
    // cambia, la pantalla tiene que avisar en vez de enseñar «undefined».
    const filas = filasDeEvidencia("desviacion_precio", { sku_id: SKU });
    expect(filas).toHaveLength(1);
    expect(filas[0]?.valor).toMatch(/No pudimos leer/);
  });

  it("ningún tipo se queda sin evidencia que enseñar", () => {
    const reales = {
      quiebre: { sku_id: SKU, stock_sistema: 1, stock_piso: 0 },
      diferencia_stock: {
        sku_id: SKU,
        stock_sistema: 1,
        stock_piso: 2,
        delta: 1,
      },
      desviacion_precio: {
        sku_id: SKU,
        precio_registrado: 1,
        precio_regular: 2,
        motivo: "sobreprecio",
      },
      promo_no_activa: { sku_id: SKU, precio_registrado: 1, precio_regular: 2 },
      contingencia: { paso: "precios", motivo: "x" },
      exhibicion_incompleta: { exhibicion_id: SKU, unidades: 2 },
    } as const;

    for (const tipo of TIPOS_ALERTA) {
      expect(filasDeEvidencia(tipo, reales[tipo]).length).toBeGreaterThan(0);
    }
  });
});

describe("accionesDeEstado", () => {
  it("no ofrece el estado en el que ya está", () => {
    for (const actual of ESTADOS_ALERTA) {
      const estados = accionesDeEstado(actual).map((a) => a.estado);
      expect(estados).not.toContain(actual);
      expect(estados).toHaveLength(ESTADOS_ALERTA.length - 1);
    }
  });

  it("una resuelta se puede reabrir: sin auditoría, un clic no puede ser definitivo", () => {
    expect(accionesDeEstado("resuelta")).toContainEqual({
      estado: "nueva",
      verbo: "Reabrir",
    });
  });

  it("cada acción trae el verbo, no el nombre del estado", () => {
    expect(accionesDeEstado("nueva").map((a) => a.verbo)).toEqual([
      "Marcar vista",
      "Marcar resuelta",
    ]);
  });
});

describe("rotuloDeFoto", () => {
  const base = {
    id: "a0000016-0000-0000-0000-000000000001",
    tipo: "quiebre",
    severidad: "alta",
    estado: "nueva",
    creado_at: "2026-08-05T14:00:00.000Z",
    payload: {},
    tienda_nombre: null,
    cadena_nombre: null,
    marca_nombre: null,
    sku_codigo: null,
    sku_nombre: null,
    visita_id: null,
    visita_check_in_at: null,
  } as const;

  it("la foto del hallazgo se nombra tal cual", () => {
    expect(
      rotuloDeFoto({
        ...base,
        foto: {
          id: "a",
          capturada_at: base.creado_at,
          subida_at: null,
          del_hallazgo: true,
        },
      }),
    ).toBe("Foto del hallazgo");
  });

  it("la del paso ADVIERTE que puede no ser de este producto", () => {
    // Solo la contingencia guarda su propia foto. En el resto, lo más que hay es
    // la foto del paso: enseñarla como si fuera la del SKU sería inventarse la
    // evidencia.
    expect(
      rotuloDeFoto({
        ...base,
        foto: {
          id: "a",
          capturada_at: base.creado_at,
          subida_at: null,
          del_hallazgo: false,
        },
      }),
    ).toMatch(/no necesariamente/);
  });
});
