import { describe, expect, it } from "vitest";

import {
  altaConfigPerfectStoreSchema,
  pesosPerfectStoreSchema,
} from "./perfect-store";

// La frontera de la configuración de Perfect Store. Lo que se prueba aquí es lo
// mismo que la base hace cumplir con sus `check`: si un día se relaja de este
// lado, Postgres sigue rechazando y el operador se come un error del sistema en
// vez de uno suyo.

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const MARCA = "cccccccc-0000-0000-0000-000000000001";
const CATEGORIA = "a0000004-0000-0000-0000-000000000001";

const PESOS = {
  peso_distribucion: 30,
  peso_visibilidad: 25,
  peso_precio: 25,
  peso_pop: 10,
  peso_orden: 10,
};

const CONFIG = {
  tenant_id: TENANT,
  marca_id: MARCA,
  sos_objetivo_pct: 35,
  vigente_desde: "2026-09-01",
  ...PESOS,
};

describe("los pesos", () => {
  it("acepta cinco pesos que suman 100", () => {
    expect(pesosPerfectStoreSchema.safeParse(PESOS).success).toBe(true);
  });

  it("rechaza unos pesos que NO suman 100", () => {
    // Sin esta regla, un puntaje "sobre 100" deja de significar lo mismo entre
    // dos marcas y la comparación que el cliente compra se rompe en silencio.
    const r = pesosPerfectStoreSchema.safeParse({
      ...PESOS,
      peso_orden: 20,
    });

    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]?.message).toMatch(/sumar 100/);
  });

  it("acepta que una variable pese CERO: el piloto no evalúa las cinco", () => {
    // Cero no es lo mismo que "no evaluada" —eso lo renormaliza el motor—, pero
    // una marca puede decidir legítimamente que el POP no le pesa.
    expect(
      pesosPerfectStoreSchema.safeParse({
        ...PESOS,
        peso_pop: 0,
        peso_distribucion: 40,
      }).success,
    ).toBe(true);
  });

  it("acepta unos pesos con decimales que suman 100", () => {
    // La trampa de la coma flotante: en JavaScript estos cinco suman
    // 100.00000000000001, así que un `=== 100` los rechazaría — y la base, con
    // `numeric(5,2)` exacto, los acepta. La frontera no puede ser más estricta
    // que lo que se guarda.
    expect(
      pesosPerfectStoreSchema.safeParse({
        peso_distribucion: 28.94,
        peso_visibilidad: 35.1,
        peso_precio: 9.04,
        peso_pop: 7.55,
        peso_orden: 19.37,
      }).success,
    ).toBe(true);
  });

  it("sigue rechazando unos decimales que de verdad no suman 100", () => {
    expect(
      pesosPerfectStoreSchema.safeParse({
        peso_distribucion: 28.94,
        peso_visibilidad: 35.1,
        peso_precio: 9.04,
        peso_pop: 7.55,
        peso_orden: 19.38,
      }).success,
    ).toBe(false);
  });

  it("rechaza un peso negativo", () => {
    expect(
      pesosPerfectStoreSchema.safeParse({
        ...PESOS,
        peso_pop: -10,
        peso_orden: 20,
      }).success,
    ).toBe(false);
  });
});

describe("altaConfigPerfectStoreSchema", () => {
  it("una configuración de marca no necesita categoría ni tipo de tienda", () => {
    const r = altaConfigPerfectStoreSchema.safeParse(CONFIG);

    expect(r.success).toBe(true);
    if (!r.success) return;
    // Null explícito, no undefined: es lo que hace colisionar la clave natural
    // `nulls not distinct` en vez de crear una fila nueva cada vez.
    expect(r.data.categoria_id).toBeNull();
    expect(r.data.tipo_tienda).toBeNull();
  });

  it("los defaults son los de la base: frentes y POP dentro del tope", () => {
    const r = altaConfigPerfectStoreSchema.safeParse(CONFIG);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.sos_unidad).toBe("frentes");
    expect(r.data.politica_pop).toBe("dentro_del_tope");
    expect(r.data.orden_bien_pts).toBe(100);
  });

  it("se puede afinar por categoría y tipo de tienda", () => {
    const r = altaConfigPerfectStoreSchema.safeParse({
      ...CONFIG,
      categoria_id: CATEGORIA,
      tipo_tienda: "hiper",
    });

    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.categoria_id).toBe(CATEGORIA);
  });

  it("rechaza una unidad de share of shelf que no está en el enum de la base", () => {
    expect(
      altaConfigPerfectStoreSchema.safeParse({
        ...CONFIG,
        sos_unidad: "metros",
      }).success,
    ).toBe(false);
  });

  it("rechaza un objetivo de share of shelf de cero", () => {
    // Un objetivo de cero no mide nada: cualquier exhibición lo cumpliría.
    const r = altaConfigPerfectStoreSchema.safeParse({
      ...CONFIG,
      sos_objetivo_pct: 0,
    });

    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]?.message).toMatch(/no mide nada/);
  });

  it("rechaza una escala cualitativa invertida", () => {
    const r = altaConfigPerfectStoreSchema.safeParse({
      ...CONFIG,
      orden_bien_pts: 10,
      orden_regular_pts: 90,
    });

    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]?.path).toEqual(["orden_regular_pts"]);
  });

  it("exige la fecha de vigencia: es lo que versiona la configuración", () => {
    const { vigente_desde: _, ...sinFecha } = CONFIG;
    expect(altaConfigPerfectStoreSchema.safeParse(sinFecha).success).toBe(
      false,
    );
  });

  it("no admite un `id`: las filas no se editan, se sustituyen", () => {
    // No hay schema de edición porque no existe la edición. Si alguien intentara
    // mandar un id, sería señal de que está tratando esto como un CRUD.
    const r = altaConfigPerfectStoreSchema.safeParse({
      ...CONFIG,
      id: "a0000019-0000-0000-0000-000000000001",
    });

    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).not.toHaveProperty("id");
  });
});
