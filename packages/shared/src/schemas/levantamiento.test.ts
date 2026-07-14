import { describe, expect, it } from "vitest";

import {
  contingenciaUploadSchema,
  exhibicionUploadSchema,
  levantamientoSkuUploadSchema,
} from "./levantamiento";

const ID = "11111111-1111-1111-1111-111111111111";
const OTRO_ID = "22222222-2222-2222-2222-222222222222";

describe("levantamientoSkuUploadSchema", () => {
  it("acepta lo que el móvil sube de verdad", () => {
    const r = levantamientoSkuUploadSchema.safeParse({
      id: ID,
      levantamiento_id: OTRO_ID,
      sku_id: OTRO_ID,
      stock_sistema: 12,
      stock_piso: 0,
      precio_registrado: 8.9,
    });
    expect(r.success).toBe(true);
  });

  it("IGNORA `quiebre` si el móvil lo manda: lo calcula la base, no el cliente", () => {
    const r = levantamientoSkuUploadSchema.parse({
      id: ID,
      levantamiento_id: OTRO_ID,
      sku_id: OTRO_ID,
      stock_sistema: 12,
      stock_piso: 0,
      // Un cliente malicioso (o un bug) podría intentar decidir él si hay quiebre.
      quiebre: false,
      diferencia: true,
    });
    expect(r).not.toHaveProperty("quiebre");
    expect(r).not.toHaveProperty("diferencia");
  });

  it("rechaza un stock negativo", () => {
    const r = levantamientoSkuUploadSchema.safeParse({
      id: ID,
      levantamiento_id: OTRO_ID,
      sku_id: OTRO_ID,
      stock_piso: -3,
    });
    expect(r.success).toBe(false);
  });

  it("rechaza un id que no es un uuid", () => {
    const r = levantamientoSkuUploadSchema.safeParse({
      id: "no-soy-un-uuid",
      levantamiento_id: OTRO_ID,
      sku_id: OTRO_ID,
    });
    expect(r.success).toBe(false);
  });
});

describe("contingenciaUploadSchema", () => {
  it("acepta una contingencia con su motivo", () => {
    const r = contingenciaUploadSchema.safeParse({
      id: ID,
      visita_id: OTRO_ID,
      paso: "quiebres",
      motivo: "Sin acceso al almacén",
      registrada_at: "2026-07-14T10:42:00-05:00",
    });
    expect(r.success).toBe(true);
  });

  it("rechaza una contingencia SIN motivo: eso no es una contingencia, es un salto", () => {
    const r = contingenciaUploadSchema.safeParse({
      id: ID,
      visita_id: OTRO_ID,
      paso: "quiebres",
      motivo: "",
      registrada_at: "2026-07-14T10:42:00-05:00",
    });
    expect(r.success).toBe(false);
  });

  it("rechaza un paso que no existe en el flujo", () => {
    const r = contingenciaUploadSchema.safeParse({
      id: ID,
      visita_id: OTRO_ID,
      paso: "inventarme_un_paso",
      motivo: "porque sí",
      registrada_at: "2026-07-14T10:42:00-05:00",
    });
    expect(r.success).toBe(false);
  });
});

describe("exhibicionUploadSchema", () => {
  it("acepta una exhibición negociada", () => {
    expect(
      exhibicionUploadSchema.safeParse({
        id: ID,
        levantamiento_id: OTRO_ID,
        exhibicion_negociada_id: OTRO_ID,
        instalada: true,
      }).success,
    ).toBe(true);
  });

  it("acepta una exhibición adicional", () => {
    expect(
      exhibicionUploadSchema.safeParse({
        id: ID,
        levantamiento_id: OTRO_ID,
        tipo_adicional: "ruma",
        instalada: true,
      }).success,
    ).toBe(true);
  });

  it("rechaza que sea negociada Y adicional a la vez", () => {
    expect(
      exhibicionUploadSchema.safeParse({
        id: ID,
        levantamiento_id: OTRO_ID,
        exhibicion_negociada_id: OTRO_ID,
        tipo_adicional: "ruma",
      }).success,
    ).toBe(false);
  });

  it("rechaza que no sea ninguna de las dos", () => {
    expect(
      exhibicionUploadSchema.safeParse({
        id: ID,
        levantamiento_id: OTRO_ID,
        instalada: true,
      }).success,
    ).toBe(false);
  });
});
