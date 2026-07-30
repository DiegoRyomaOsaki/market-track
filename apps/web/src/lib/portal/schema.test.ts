import { describe, expect, it } from "vitest";

import { guardarModulosSchema } from "./schema";

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const MODULOS = {
  dashboard: true,
  mapa: true,
  galeria: false,
  alertas: true,
  reportes: true,
};

describe("guardarModulosSchema", () => {
  it("acepta un payload válido", () => {
    expect(
      guardarModulosSchema.safeParse({ tenant_id: TENANT, modulos: MODULOS })
        .success,
    ).toBe(true);
  });

  it("exige un tenant_id que sea uuid", () => {
    expect(
      guardarModulosSchema.safeParse({ tenant_id: "no-uuid", modulos: MODULOS })
        .success,
    ).toBe(false);
  });

  it("rechaza un valor de módulo que no es booleano", () => {
    expect(
      guardarModulosSchema.safeParse({
        tenant_id: TENANT,
        modulos: { ...MODULOS, mapa: "sí" },
      }).success,
    ).toBe(false);
  });

  it("rechaza una clave de módulo desconocida", () => {
    expect(
      guardarModulosSchema.safeParse({
        tenant_id: TENANT,
        modulos: { ...MODULOS, facturacion: true },
      }).success,
    ).toBe(false);
  });
});
