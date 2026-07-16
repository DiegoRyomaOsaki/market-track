import { describe, expect, it } from "vitest";

import { altaUsuarioSchema, aPayloadCrearUsuario } from "./schema";

const TENANT = "00000000-0000-0000-0000-000000000001";
const SUP = "00000000-0000-0000-0000-000000000002";
const base = {
  email: "a@market-track.pe",
  password: "clave1234",
  nombre: "Ana",
  dni: "12345678",
};

function ok(datos: Record<string, unknown>) {
  return altaUsuarioSchema.safeParse(datos).success;
}

describe("altaUsuarioSchema — reglas por rol", () => {
  it("mercaderista válido: con cliente-marca y supervisor", () => {
    expect(
      ok({
        ...base,
        rol: "mercaderista",
        tenant_id: TENANT,
        supervisor_id: SUP,
      }),
    ).toBe(true);
  });

  it("mercaderista sin supervisor falla (aunque tenga cliente-marca)", () => {
    expect(ok({ ...base, rol: "mercaderista", tenant_id: TENANT })).toBe(false);
  });

  it("mercaderista sin cliente-marca falla (aunque tenga supervisor)", () => {
    expect(ok({ ...base, rol: "mercaderista", supervisor_id: SUP })).toBe(
      false,
    );
  });

  it("el staff NO lleva cliente-marca (admin y supervisor)", () => {
    expect(ok({ ...base, rol: "admin" })).toBe(true);
    expect(ok({ ...base, rol: "admin", tenant_id: TENANT })).toBe(false);
    expect(ok({ ...base, rol: "supervisor", tenant_id: TENANT })).toBe(false);
  });

  it("el cliente necesita cliente-marca, no supervisor", () => {
    expect(ok({ ...base, rol: "cliente", tenant_id: TENANT })).toBe(true);
    expect(ok({ ...base, rol: "cliente" })).toBe(false);
  });

  it("una cadena vacía en tenant_id NO cuenta como cliente-marca", () => {
    expect(ok({ ...base, rol: "cliente", tenant_id: "" })).toBe(false);
    expect(
      ok({ ...base, rol: "mercaderista", tenant_id: "", supervisor_id: SUP }),
    ).toBe(false);
  });
});

describe("altaUsuarioSchema — campos base", () => {
  it("rechaza un correo inválido", () => {
    expect(ok({ ...base, rol: "admin", email: "no-es-correo" })).toBe(false);
  });

  it("la contraseña exige mínimo 8 (7 falla, 8 pasa)", () => {
    expect(ok({ ...base, rol: "admin", password: "1234567" })).toBe(false);
    expect(ok({ ...base, rol: "admin", password: "12345678" })).toBe(true);
  });

  it("nombre y dni son obligatorios", () => {
    expect(ok({ ...base, rol: "admin", nombre: "" })).toBe(false);
    expect(ok({ ...base, rol: "admin", dni: "" })).toBe(false);
  });

  it("un tenant_id no-UUID (y no vacío) se rechaza", () => {
    expect(ok({ ...base, rol: "cliente", tenant_id: "abc" })).toBe(false);
  });
});

describe("aPayloadCrearUsuario", () => {
  it("convierte las cadenas vacías en null explícito", () => {
    const p = aPayloadCrearUsuario({
      ...base,
      rol: "admin",
      tenant_id: "",
      supervisor_id: "",
      telefono: "",
    });
    expect(p.tenant_id).toBeNull();
    expect(p.supervisor_id).toBeNull();
    expect(p.telefono).toBeNull();
  });

  it("preserva los valores presentes", () => {
    const p = aPayloadCrearUsuario({
      ...base,
      rol: "mercaderista",
      tenant_id: TENANT,
      supervisor_id: SUP,
      telefono: "999888777",
    });
    expect(p.tenant_id).toBe(TENANT);
    expect(p.supervisor_id).toBe(SUP);
    expect(p.telefono).toBe("999888777");
  });
});
