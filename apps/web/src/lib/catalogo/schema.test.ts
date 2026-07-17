import { describe, expect, it } from "vitest";

import {
  aFilaTienda,
  altaCadenaSchema,
  altaSkuSchema,
  altaTiendaSchema,
  codificadoSchema,
} from "./schema";

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const CADENA = "a0000001-0000-0000-0000-000000000001";
const MARCA = "cccccccc-0000-0000-0000-000000000001";
const SKU = "a0000003-0000-0000-0000-000000000001";
const TIENDA = "a0000002-0000-0000-0000-000000000001";

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

const SKU_OK = {
  nombre: "Licuadora Oster 3 velocidades",
  tenant_id: TENANT,
  marca_id: MARCA,
  codigo: "OST-LIC-3V",
};

describe("altaSkuSchema", () => {
  it("acepta un SKU con su marca y su código", () => {
    const s = altaSkuSchema.parse(SKU_OK);
    expect(s.codigo).toBe("OST-LIC-3V");
    expect(s.marca_id).toBe(MARCA);
  });

  it("el SKU cuelga de la MARCA, no del cliente: exige marca_id", () => {
    const { marca_id: _, ...sinMarca } = SKU_OK;
    expect(altaSkuSchema.safeParse(sinMarca).success).toBe(false);
    expect(
      altaSkuSchema.safeParse({ ...SKU_OK, marca_id: "no-uuid" }).success,
    ).toBe(false);
  });

  it("exige código y nombre no vacíos", () => {
    expect(altaSkuSchema.safeParse({ ...SKU_OK, codigo: "" }).success).toBe(
      false,
    );
    expect(altaSkuSchema.safeParse({ ...SKU_OK, codigo: "   " }).success).toBe(
      false,
    );
    expect(altaSkuSchema.safeParse({ ...SKU_OK, nombre: "" }).success).toBe(
      false,
    );
  });

  it("recorta el código: un espacio final rompería el cruce con el Excel del cliente", () => {
    expect(altaSkuSchema.parse({ ...SKU_OK, codigo: "  OST-1  " }).codigo).toBe(
      "OST-1",
    );
  });

  it("los opcionales vacíos viajan como null (el UNIQUE de codigo_externo no tolera dos '')", () => {
    const s = altaSkuSchema.parse({
      ...SKU_OK,
      presentacion: "  ",
      codigo_barras: "",
      codigo_externo: " ",
    });
    expect(s.presentacion).toBeNull();
    expect(s.codigo_barras).toBeNull();
    expect(s.codigo_externo).toBeNull();
  });
});

describe("codificadoSchema", () => {
  it("acepta un codificado válido: qué SKU, en qué tienda, activo o no", () => {
    const c = codificadoSchema.parse({
      tienda_id: TIENDA,
      sku_id: SKU,
      activo: true,
    });
    expect(c.activo).toBe(true);
  });

  it("NO acepta un tenant_id del cliente: lo re-deriva el servidor de la tienda", () => {
    const c = codificadoSchema.parse({
      tienda_id: TIENDA,
      sku_id: SKU,
      activo: true,
      tenant_id: "bbbbbbbb-0000-0000-0000-000000000002",
    });
    expect(c).not.toHaveProperty("tenant_id");
  });

  it("codificar es un valor explícito, no una casilla ausente", () => {
    // Un checkbox desmarcado no viaja en el FormData: el llamante decide el
    // booleano, y aquí se exige — no se asume `true` por defecto.
    expect(
      codificadoSchema.safeParse({ tienda_id: TIENDA, sku_id: SKU }).success,
    ).toBe(false);
  });

  it("rechaza ids que no son uuid antes de que lleguen a la base", () => {
    expect(
      codificadoSchema.safeParse({ tienda_id: "x", sku_id: SKU, activo: true })
        .success,
    ).toBe(false);
    expect(
      codificadoSchema.safeParse({
        tienda_id: TIENDA,
        sku_id: "y",
        activo: true,
      }).success,
    ).toBe(false);
  });
});
