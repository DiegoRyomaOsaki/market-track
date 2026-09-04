import { describe, expect, it } from "vitest";

import { altaClienteSchema, altaMarcaSchema } from "./schema";

const CLIENTE_OK = { nombre: "Maracumango", activo: true };
const MARCA_OK = {
  nombre: "Oster",
  tenant_id: "aaaaaaaa-0000-0000-0000-000000000001",
  tolerancia_precio_pct: 5,
  activo: true,
};

describe("altaClienteSchema", () => {
  it("acepta un cliente con nombre", () => {
    expect(altaClienteSchema.parse(CLIENTE_OK).nombre).toBe("Maracumango");
  });

  it("recorta el nombre", () => {
    expect(
      altaClienteSchema.parse({ ...CLIENTE_OK, nombre: "  Oster  " }).nombre,
    ).toBe("Oster");
  });

  it("rechaza un nombre vacío o de solo espacios", () => {
    expect(
      altaClienteSchema.safeParse({ ...CLIENTE_OK, nombre: "" }).success,
    ).toBe(false);
    expect(
      altaClienteSchema.safeParse({ ...CLIENTE_OK, nombre: "   " }).success,
    ).toBe(false);
  });
});

describe("altaMarcaSchema", () => {
  it("acepta una marca con su cliente y su tolerancia", () => {
    const m = altaMarcaSchema.parse(MARCA_OK);
    expect(m.nombre).toBe("Oster");
    expect(m.tolerancia_precio_pct).toBe(5);
  });

  it("exige un cliente: la marca cuelga del cliente, nunca suelta", () => {
    const { tenant_id: _, ...sinCliente } = MARCA_OK;
    expect(altaMarcaSchema.safeParse(sinCliente).success).toBe(false);
    expect(
      altaMarcaSchema.safeParse({ ...MARCA_OK, tenant_id: "no-es-uuid" })
        .success,
    ).toBe(false);
  });

  it("acepta una tolerancia de 0 — es un valor real, no 'sin valor'", () => {
    // 0% significa que CUALQUIER desviación alerta. Un `.min(1)` o un falsy check
    // lo convertiría en silencio en el default y apagaría las alertas de esa marca.
    const m = altaMarcaSchema.parse({ ...MARCA_OK, tolerancia_precio_pct: 0 });
    expect(m.tolerancia_precio_pct).toBe(0);
  });

  it("rechaza una tolerancia negativa o mayor que 100", () => {
    expect(
      altaMarcaSchema.safeParse({ ...MARCA_OK, tolerancia_precio_pct: -1 })
        .success,
    ).toBe(false);
    expect(
      altaMarcaSchema.safeParse({ ...MARCA_OK, tolerancia_precio_pct: 100.01 })
        .success,
    ).toBe(false);
  });

  it("rechaza más de 2 decimales: la columna es numeric(5,2) y redondearía en silencio", () => {
    expect(
      altaMarcaSchema.safeParse({ ...MARCA_OK, tolerancia_precio_pct: 5.125 })
        .success,
    ).toBe(false);
    expect(
      altaMarcaSchema.safeParse({ ...MARCA_OK, tolerancia_precio_pct: 5.12 })
        .success,
    ).toBe(true);
  });

  it.each([1.1, 8.29, 0.07, 2.35, 99.99])(
    "acepta %s: los decimales que la coma flotante no representa exacto también valen",
    (v) => {
      // `1.1 * 100` es 110.00000000000001 en binario. Un check ingenuo de
      // decimales rechazaría una tolerancia de UN decimal.
      expect(
        altaMarcaSchema.safeParse({ ...MARCA_OK, tolerancia_precio_pct: v })
          .success,
      ).toBe(true);
    },
  );

  it("rechaza una tolerancia que no es número", () => {
    expect(
      altaMarcaSchema.safeParse({ ...MARCA_OK, tolerancia_precio_pct: "cinco" })
        .success,
    ).toBe(false);
    expect(
      altaMarcaSchema.safeParse({
        ...MARCA_OK,
        tolerancia_precio_pct: Number.NaN,
      }).success,
    ).toBe(false);
  });

  it("el código externo vacío viaja como null, no como cadena vacía", () => {
    // La columna tiene UNIQUE (tenant_id, codigo_externo). En Postgres varios NULL
    // conviven, pero dos cadenas vacías chocan: la segunda marca sin código
    // reventaría contra el índice.
    expect(
      altaMarcaSchema.parse({ ...MARCA_OK, codigo_externo: "" }).codigo_externo,
    ).toBeNull();
    expect(
      altaMarcaSchema.parse({ ...MARCA_OK, codigo_externo: "  " })
        .codigo_externo,
    ).toBeNull();
    expect(
      altaMarcaSchema.parse({ ...MARCA_OK, codigo_externo: " OST-1 " })
        .codigo_externo,
    ).toBe("OST-1");
  });
});
