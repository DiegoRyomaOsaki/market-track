import { describe, expect, it } from "vitest";

import {
  ACCIONES_TOMADAS,
  detalleIncidenciaSchema,
  resolucionIncidenciaSchema,
} from "./incidencia";

const ATENDIDA_AT = "2026-09-02T14:30:00-05:00";

describe("resolucionIncidenciaSchema", () => {
  it("acepta una incidencia resuelta con su acción y su foto", () => {
    const r = resolucionIncidenciaSchema.parse({
      estado: "resuelta",
      accion_tomada: "Repuse 12 unidades desde el almacén de la tienda",
      foto_resolucion_id: "0195f1a0-1f4c-7b3d-9a2e-1c2d3e4f5a6b",
      atendida_at: ATENDIDA_AT,
    });
    expect(r.estado).toBe("resuelta");
  });

  it("acepta una incidencia no resuelta con su motivo", () => {
    const r = resolucionIncidenciaSchema.parse({
      estado: "no_resuelta",
      motivo: "El encargado de la tienda no autorizó tocar la góndola",
      atendida_at: ATENDIDA_AT,
    });
    expect(r.estado).toBe("no_resuelta");
  });

  it("rechaza resolver sin decir qué se hizo", () => {
    expect(
      resolucionIncidenciaSchema.safeParse({
        estado: "resuelta",
        atendida_at: ATENDIDA_AT,
      }).success,
    ).toBe(false);
  });

  it("rechaza una acción que es solo espacios", () => {
    expect(
      resolucionIncidenciaSchema.safeParse({
        estado: "resuelta",
        accion_tomada: "   ",
        atendida_at: ATENDIDA_AT,
      }).success,
    ).toBe(false);
  });

  it("rechaza no resolver sin decir por qué", () => {
    expect(
      resolucionIncidenciaSchema.safeParse({
        estado: "no_resuelta",
        atendida_at: ATENDIDA_AT,
      }).success,
    ).toBe(false);
  });

  // El texto baja a un teléfono por la réplica y la base lo acota a 500: si el
  // esquema lo dejara pasar, la escritura moriría con un 23514 que el conector
  // clasifica como permanente y descarta.
  it("rechaza un motivo más largo que el límite de la columna", () => {
    expect(
      resolucionIncidenciaSchema.safeParse({
        estado: "no_resuelta",
        motivo: "x".repeat(501),
        atendida_at: ATENDIDA_AT,
      }).success,
    ).toBe(false);
  });

  it("rechaza una foto de resolución que no es un uuid", () => {
    expect(
      resolucionIncidenciaSchema.safeParse({
        estado: "resuelta",
        accion_tomada: "Repuse el producto",
        foto_resolucion_id: "no-es-un-uuid",
        atendida_at: ATENDIDA_AT,
      }).success,
    ).toBe(false);
  });

  it("rechaza una resolución sin la hora en que se atendió", () => {
    expect(
      resolucionIncidenciaSchema.safeParse({
        estado: "resuelta",
        accion_tomada: "Repuse el producto",
      }).success,
    ).toBe(false);
  });

  // `anulada` es del motor: es el estado que se escribe cuando el hallazgo deja
  // de existir. Desde la app sería la forma de vaciar la lista sin atenderla, y
  // la política de la base también lo niega.
  it("rechaza que la app anule una incidencia", () => {
    expect(
      resolucionIncidenciaSchema.safeParse({
        estado: "anulada",
        atendida_at: ATENDIDA_AT,
      }).success,
    ).toBe(false);
  });

  it("rechaza dejarla pendiente: atender es decidir", () => {
    expect(
      resolucionIncidenciaSchema.safeParse({
        estado: "pendiente",
        atendida_at: ATENDIDA_AT,
      }).success,
    ).toBe(false);
  });
});

describe("detalleIncidenciaSchema", () => {
  it("lee los números de un quiebre", () => {
    const d = detalleIncidenciaSchema.parse({
      stock_sistema: 10,
      stock_piso: 0,
    });
    expect(d.stock_sistema).toBe(10);
  });

  // El motor puede añadir una clave —ya lo hizo con `delta`— y un teléfono con
  // una versión vieja de la app tiene que seguir pintando la lista.
  it("tolera una clave que esta versión de la app no conoce", () => {
    const d = detalleIncidenciaSchema.parse({
      stock_piso: 0,
      severidad_futura: "critica",
    });
    expect(d.stock_piso).toBe(0);
  });

  it("tolera que falten todas: un detalle vacío es válido", () => {
    expect(detalleIncidenciaSchema.parse({})).toEqual({});
  });

  // `.catch({})` es la diferencia entre una lista que se pinta sin ese dato y
  // una pantalla en blanco.
  it("un detalle malformado cae a vacío en vez de romper la pantalla", () => {
    expect(detalleIncidenciaSchema.parse("no soy un objeto")).toEqual({});
    expect(detalleIncidenciaSchema.parse(null)).toEqual({});
  });
});

describe("ACCIONES_TOMADAS", () => {
  it("todas caben en lo que la base acepta", () => {
    // El CHECK de la columna corta en 500. Una frase enlatada que no quepa
    // volvería como 23514, y el conector descarta ese error en silencio.
    for (const accion of ACCIONES_TOMADAS) {
      expect(accion.length).toBeLessThanOrEqual(500);
      expect(accion.trim()).not.toBe("");
    }
  });

  it("cada una vale como acción de una resolución", () => {
    for (const accion of ACCIONES_TOMADAS) {
      const r = resolucionIncidenciaSchema.safeParse({
        estado: "resuelta",
        accion_tomada: accion,
        atendida_at: "2026-09-04T14:30:00-05:00",
      });
      expect(r.success).toBe(true);
    }
  });
});
