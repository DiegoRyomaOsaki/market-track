import { describe, expect, it } from "vitest";

import { guardarModulosSchema } from "./schema";

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const MODULOS = {
  dashboard: true,
  mapa: true,
  galeria: false,
  alertas: true,
  reportes: true,
  perfect_store: true,
};

describe("guardarModulosSchema", () => {
  it("acepta un payload válido", () => {
    expect(
      guardarModulosSchema.safeParse({ tenant_id: TENANT, modulos: MODULOS })
        .success,
    ).toBe(true);
  });

  it("exige un tenant_id presente, no vacío y con forma de uuid", () => {
    expect(
      guardarModulosSchema.safeParse({ tenant_id: "no-uuid", modulos: MODULOS })
        .success,
    ).toBe(false);
    expect(
      guardarModulosSchema.safeParse({ tenant_id: "", modulos: MODULOS })
        .success,
    ).toBe(false);
    expect(guardarModulosSchema.safeParse({ modulos: MODULOS }).success).toBe(
      false,
    );
  });

  it("es EXHAUSTIVO: rechaza un payload al que le falta un módulo", () => {
    const { reportes: _omitido, ...parcial } = MODULOS;
    expect(
      guardarModulosSchema.safeParse({ tenant_id: TENANT, modulos: parcial })
        .success,
    ).toBe(false);
  });

  it("rechaza un objeto de módulos vacío", () => {
    expect(
      guardarModulosSchema.safeParse({ tenant_id: TENANT, modulos: {} })
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
