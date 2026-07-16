import { describe, expect, it } from "vitest";

import { altaUsuarioSchema, aPayloadCrearUsuario } from "./schema";

const base = {
  email: "a@market-track.pe",
  password: "clave1234",
  nombre: "Ana",
  dni: "12345678",
};

describe("altaUsuarioSchema", () => {
  it("un mercaderista necesita cliente-marca y supervisor", () => {
    expect(
      altaUsuarioSchema.safeParse({ ...base, rol: "mercaderista" }).success,
    ).toBe(false);
    expect(
      altaUsuarioSchema.safeParse({
        ...base,
        rol: "mercaderista",
        tenant_id: "00000000-0000-0000-0000-000000000001",
        supervisor_id: "00000000-0000-0000-0000-000000000002",
      }).success,
    ).toBe(true);
  });

  it("el staff (admin/supervisor) NO lleva cliente-marca", () => {
    expect(altaUsuarioSchema.safeParse({ ...base, rol: "admin" }).success).toBe(
      true,
    );
    expect(
      altaUsuarioSchema.safeParse({
        ...base,
        rol: "supervisor",
        tenant_id: "00000000-0000-0000-0000-000000000001",
      }).success,
    ).toBe(false);
  });

  it("el cliente necesita cliente-marca pero no supervisor", () => {
    expect(
      altaUsuarioSchema.safeParse({
        ...base,
        rol: "cliente",
        tenant_id: "00000000-0000-0000-0000-000000000001",
      }).success,
    ).toBe(true);
    expect(
      altaUsuarioSchema.safeParse({ ...base, rol: "cliente" }).success,
    ).toBe(false);
  });

  it("la contraseña exige mínimo 8 caracteres", () => {
    expect(
      altaUsuarioSchema.safeParse({ ...base, password: "corta", rol: "admin" })
        .success,
    ).toBe(false);
  });
});

describe("aPayloadCrearUsuario", () => {
  it("convierte las cadenas vacías en null explícito", () => {
    const payload = aPayloadCrearUsuario({
      ...base,
      rol: "admin",
      tenant_id: "",
      supervisor_id: "",
      telefono: "",
    });
    expect(payload.tenant_id).toBeNull();
    expect(payload.supervisor_id).toBeNull();
    expect(payload.telefono).toBeNull();
  });
});
