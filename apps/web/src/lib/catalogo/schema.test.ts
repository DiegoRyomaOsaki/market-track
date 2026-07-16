import { describe, expect, it } from "vitest";

import { aFilaTienda, altaCadenaSchema, altaTiendaSchema } from "./schema";

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const CADENA = "a0000001-0000-0000-0000-000000000001";

const CADENA_OK = {
  nombre: "Plaza Vea",
  tenant_id: TENANT,
  tipo_tienda: "super",
};
const TIENDA_OK = {
  nombre: "Plaza Vea La Molina",
  tenant_id: TENANT,
  cadena_id: CADENA,
  lat: -12.08,
  lon: -76.94,
  radio_geocerca_m: 100,
};

describe("altaCadenaSchema", () => {
  it("acepta una cadena con su tipo", () => {
    expect(altaCadenaSchema.parse(CADENA_OK).tipo_tienda).toBe("super");
  });

  it("acepta una cadena sin tipo: la columna lo permite", () => {
    const { tipo_tienda: _, ...sinTipo } = CADENA_OK;
    expect(altaCadenaSchema.parse(sinTipo).tipo_tienda).toBeNull();
  });

  it("rechaza un tipo que no está en el enum de la base", () => {
    expect(
      altaCadenaSchema.safeParse({ ...CADENA_OK, tipo_tienda: "mayorista" })
        .success,
    ).toBe(false);
  });
});

describe("altaTiendaSchema", () => {
  it("acepta una tienda completa", () => {
    expect(altaTiendaSchema.parse(TIENDA_OK).radio_geocerca_m).toBe(100);
  });

  it("el radio por defecto es 100 m", () => {
    const { radio_geocerca_m: _, ...sinRadio } = TIENDA_OK;
    expect(altaTiendaSchema.parse(sinRadio).radio_geocerca_m).toBe(100);
  });

  it("rechaza un radio de 0 o negativo — la base tiene el mismo CHECK", () => {
    // Un radio de 0 no es "sin geocerca": es una tienda donde NADIE puede hacer
    // check-in nunca.
    expect(
      altaTiendaSchema.safeParse({ ...TIENDA_OK, radio_geocerca_m: 0 }).success,
    ).toBe(false);
    expect(
      altaTiendaSchema.safeParse({ ...TIENDA_OK, radio_geocerca_m: -5 })
        .success,
    ).toBe(false);
  });

  it("rechaza un radio con decimales: la columna es integer", () => {
    expect(
      altaTiendaSchema.safeParse({ ...TIENDA_OK, radio_geocerca_m: 100.5 })
        .success,
    ).toBe(false);
  });

  it("exige ubicación: sin punto no hay geocerca que valga", () => {
    const { lat: _, ...sinLat } = TIENDA_OK;
    expect(altaTiendaSchema.safeParse(sinLat).success).toBe(false);
  });

  it("rechaza coordenadas fuera del planeta", () => {
    expect(altaTiendaSchema.safeParse({ ...TIENDA_OK, lat: 91 }).success).toBe(
      false,
    );
    expect(
      altaTiendaSchema.safeParse({ ...TIENDA_OK, lon: -181 }).success,
    ).toBe(false);
  });
});

describe("aFilaTienda", () => {
  it("convierte lat/lon en la ubicación EWKT que espera PostGIS", () => {
    const fila = aFilaTienda(altaTiendaSchema.parse(TIENDA_OK));
    expect(fila.ubicacion).toBe("SRID=4326;POINT(-76.94 -12.08)");
  });

  it("NO manda lat ni lon: son columnas generadas y Postgres las rechaza", () => {
    // Los tipos generados por Supabase las ofrecen en Insert/Update, así que
    // TypeScript no protege de esto: el error saldría en runtime
    // ("column lat can only be updated to DEFAULT").
    const fila = aFilaTienda(altaTiendaSchema.parse(TIENDA_OK));
    expect(fila).not.toHaveProperty("lat");
    expect(fila).not.toHaveProperty("lon");
  });

  it("el código externo vacío viaja como null (choca con el UNIQUE si no)", () => {
    const fila = aFilaTienda(
      altaTiendaSchema.parse({ ...TIENDA_OK, codigo_externo: "  " }),
    );
    expect(fila.codigo_externo).toBeNull();
  });
});
