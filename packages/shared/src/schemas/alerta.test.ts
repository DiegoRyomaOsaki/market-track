import { describe, expect, it } from "vitest";

import { TIPOS_ALERTA } from "../enums";

import { detalleAlertaSchema, PAYLOAD_ALERTA } from "./alerta";

// El contrato con el motor de alertas. Cada payload de aquí está copiado de lo
// que `app.alertas_*` construye con `jsonb_build_object`: si una migración
// renombra una clave, este archivo se pone rojo antes que la pantalla.

const SKU = "a0000003-0000-0000-0000-000000000001";
const MERCADERISTA = "e4000000-0000-0000-0000-000000000001";

describe("PAYLOAD_ALERTA", () => {
  it("cubre todos los tipos del enum, sin caso por defecto", () => {
    expect(Object.keys(PAYLOAD_ALERTA).sort()).toEqual(
      [...TIPOS_ALERTA].sort(),
    );
  });

  it("acepta lo que el motor escribe de verdad, tipo por tipo", () => {
    const reales = {
      quiebre: { sku_id: SKU, stock_sistema: 20, stock_piso: 0 },
      diferencia_stock: {
        sku_id: SKU,
        stock_sistema: 20,
        stock_piso: 14,
        delta: -6,
      },
      desviacion_precio: {
        sku_id: SKU,
        precio_registrado: 12.9,
        precio_regular: 9.9,
        motivo: "sobreprecio",
      },
      promo_no_activa: {
        sku_id: SKU,
        precio_registrado: 7.5,
        precio_regular: 9.9,
      },
      contingencia: { paso: "precios", motivo: "Góndola en remodelación" },
      exhibicion_incompleta: { exhibicion_id: SKU, unidades: 3 },
      verificacion_fotos: {
        mercaderista_id: MERCADERISTA,
        periodo_tipo: "mensual",
        periodo_inicio: "2026-02-01",
        fotos_subidas: 40,
        fotos_verificadas: 5,
        pct_sin_verificar: 87.5,
        umbral_pct: 20,
      },
    } as const;

    for (const tipo of TIPOS_ALERTA) {
      expect(PAYLOAD_ALERTA[tipo].safeParse(reales[tipo]).success).toBe(true);
    }
  });

  it("el stock puede venir nulo: el mercaderista pudo no contarlo", () => {
    expect(
      PAYLOAD_ALERTA.quiebre.safeParse({
        sku_id: SKU,
        stock_sistema: null,
        stock_piso: null,
      }).success,
    ).toBe(true);
  });

  it("una clave de más NO invalida: el motor puede añadir sin romper el portal", () => {
    const con = PAYLOAD_ALERTA.contingencia.safeParse({
      paso: "precios",
      motivo: "x",
      contingencia_id: SKU,
    });
    expect(con.success).toBe(true);
  });

  it("rechaza el motivo de precio que no está en el árbol de decisión", () => {
    expect(
      PAYLOAD_ALERTA.desviacion_precio.safeParse({
        sku_id: SKU,
        precio_registrado: 1,
        precio_regular: 2,
        motivo: "porque_si",
      }).success,
    ).toBe(false);
  });

  it("rechaza un payload al que le falta lo que la pantalla va a pintar", () => {
    expect(
      PAYLOAD_ALERTA.desviacion_precio.safeParse({ sku_id: SKU }).success,
    ).toBe(false);
  });
});

describe("detalleAlertaSchema", () => {
  const base = {
    id: "a0000016-0000-0000-0000-000000000001",
    tipo: "quiebre",
    severidad: "alta",
    estado: "nueva",
    creado_at: "2026-08-05T14:00:00.000Z",
    payload: { sku_id: SKU },
    tienda_nombre: "Plaza Vea Surco",
    cadena_nombre: "Plaza Vea",
    marca_nombre: "Oster",
    sku_codigo: "MRC-001",
    sku_nombre: "Néctar 1L",
    visita_id: "a0000010-0000-0000-0000-000000000001",
    visita_check_in_at: "2026-08-05T13:00:00.000Z",
    foto: null,
  };

  it("acepta el detalle completo", () => {
    expect(detalleAlertaSchema.safeParse(base).success).toBe(true);
  });

  it("acepta la alerta sin visita, sin marca y sin SKU", () => {
    // La contingencia de una VISITA no cuelga de ninguna marca, y ese caso es
    // frecuente: el bypass en el check-in.
    const suelta = {
      ...base,
      tipo: "contingencia",
      payload: { paso: "checkin", motivo: "Tienda cerrada" },
      marca_nombre: null,
      sku_codigo: null,
      sku_nombre: null,
      tienda_nombre: null,
      cadena_nombre: null,
      visita_id: null,
      visita_check_in_at: null,
    };
    expect(detalleAlertaSchema.safeParse(suelta).success).toBe(true);
  });

  it("la foto trae si es del hallazgo o solo del paso", () => {
    const con = detalleAlertaSchema.safeParse({
      ...base,
      foto: {
        id: "a0000015-0000-0000-0000-000000000001",
        capturada_at: "2026-08-05T14:00:00.000Z",
        subida_at: null,
        del_hallazgo: false,
      },
    });
    expect(con.success).toBe(true);
    expect(con.data?.foto?.del_hallazgo).toBe(false);
  });

  it("rechaza una foto sin `del_hallazgo`: sin eso no se sabe cómo rotularla", () => {
    expect(
      detalleAlertaSchema.safeParse({
        ...base,
        foto: {
          id: "a0000015-0000-0000-0000-000000000001",
          capturada_at: "2026-08-05T14:00:00.000Z",
          subida_at: null,
        },
      }).success,
    ).toBe(false);
  });
});
