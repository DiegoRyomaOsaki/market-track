import { describe, expect, it } from "vitest";

import {
  altaExhibicionSchema,
  altaPrecioRegularSchema,
  altaPromocionSchema,
} from "./schema";

// La frontera del formulario. Lo que se prueba es lo que la base también hace
// cumplir: si un día se relaja aquí, el `check` de Postgres sigue rechazando y el
// operador se come un error del sistema en vez de uno suyo.

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const SKU = "a0000003-0000-0000-0000-000000000001";
const CADENA = "a0000001-0000-0000-0000-000000000001";
const TIENDA = "a0000002-0000-0000-0000-000000000001";
const MARCA = "cccccccc-0000-0000-0000-000000000001";

const PRECIO = {
  tenant_id: TENANT,
  sku_id: SKU,
  cadena_id: CADENA,
  precio: 6.9,
  vigente_desde: "2026-09-01",
};

const PROMO = {
  tenant_id: TENANT,
  sku_id: SKU,
  precio_promo: 5.9,
  fecha_inicio: "2026-09-01",
  fecha_fin: "2026-09-30",
};

const EXHIBICION = {
  tenant_id: TENANT,
  tienda_id: TIENDA,
  marca_id: MARCA,
  tipo: "cabecera",
  fecha_inicio: "2026-09-01",
  fecha_fin: "2026-09-30",
};

describe("altaPrecioRegularSchema", () => {
  it("acepta un precio sin tipo de tienda: aplica a toda la cadena", () => {
    const r = altaPrecioRegularSchema.safeParse(PRECIO);
    expect(r.success).toBe(true);
    if (!r.success) return;
    // El campo ausente llega como null, no como undefined: es lo que la columna
    // nullable espera, y lo que hace colisionar la clave `nulls not distinct`.
    expect(r.data.tipo_tienda).toBeNull();
  });

  it("rechaza un precio negativo", () => {
    expect(
      altaPrecioRegularSchema.safeParse({ ...PRECIO, precio: -1 }).success,
    ).toBe(false);
  });

  it("rechaza un tipo de tienda que no está en el enum de la base", () => {
    expect(
      altaPrecioRegularSchema.safeParse({
        ...PRECIO,
        tipo_tienda: "bodega-de-la-esquina",
      }).success,
    ).toBe(false);
  });

  it("exige la fecha de vigencia: forma parte de la clave natural", () => {
    const { vigente_desde: _, ...sinFecha } = PRECIO;
    expect(altaPrecioRegularSchema.safeParse(sinFecha).success).toBe(false);
  });
});

describe("altaPromocionSchema", () => {
  it("una promo sin clusters vale para TODAS las tiendas", () => {
    const r = altaPromocionSchema.safeParse(PROMO);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.clusters).toEqual([]);
    // Una promo no comunicada es el caso por defecto: el cartel se pone después.
    expect(r.data.comunicada).toBe(false);
  });

  it("rechaza una promo que termina antes de empezar", () => {
    const r = altaPromocionSchema.safeParse({
      ...PROMO,
      fecha_fin: "2026-08-31",
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]?.path).toEqual(["fecha_fin"]);
  });

  it("acepta una promo de un solo día", () => {
    expect(
      altaPromocionSchema.safeParse({ ...PROMO, fecha_fin: PROMO.fecha_inicio })
        .success,
    ).toBe(true);
  });

  it("rechaza un cluster en blanco: sería un filtro que no filtra nada", () => {
    expect(
      altaPromocionSchema.safeParse({ ...PROMO, clusters: ["  "] }).success,
    ).toBe(false);
  });
});

describe("altaExhibicionSchema", () => {
  it("acepta un espacio negociado sin SKUs todavía", () => {
    // Se negocia la cabecera antes de decidir qué entra en ella.
    const r = altaExhibicionSchema.safeParse(EXHIBICION);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.sku_ids).toEqual([]);
    expect(r.data.cantidad_sugerida).toBeNull();
  });

  it("rechaza un tipo de exhibición que no está en el enum de la base", () => {
    expect(
      altaExhibicionSchema.safeParse({ ...EXHIBICION, tipo: "vitrina" })
        .success,
    ).toBe(false);
  });

  it("rechaza una exhibición que termina antes de empezar", () => {
    const r = altaExhibicionSchema.safeParse({
      ...EXHIBICION,
      fecha_fin: "2026-08-31",
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]?.path).toEqual(["fecha_fin"]);
  });

  it("rechaza una cantidad sugerida negativa", () => {
    expect(
      altaExhibicionSchema.safeParse({
        ...EXHIBICION,
        cantidad_sugerida: -3,
      }).success,
    ).toBe(false);
  });
});
