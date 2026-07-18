import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Checks ESTÁTICOS de las sync rules: rápidos, sin servicios, corren en CI.
// El aislamiento en vivo (que exige el servicio PowerSync levantado) va en
// test/aislamiento.sync.test.ts, bajo `test:sync`.

const streams = readFileSync(
  fileURLToPath(new URL("../config/streams.yaml", import.meta.url)),
  "utf8",
);

describe("streams.yaml — contrato de seguridad", () => {
  it("es edición 3 (la legacy con request.user_id() está obsoleta)", () => {
    expect(streams).toMatch(/edition:\s*3/);
    // request.user_id() es sintaxis legacy: en edición 3 se rechaza al arrancar.
    expect(streams).not.toMatch(/request\.user_id\(\)/);
  });

  it("el acceso se apoya en el usuario del token, no en el cliente", () => {
    expect(streams).toMatch(/auth\.user_id\(\)/);
  });

  it("NUNCA filtra por parámetros que controla el cliente", () => {
    // connection.parameter y subscription.parameter los envía el cliente y puede
    // poner cualquier valor: usarlos para control de acceso es la fuga entre
    // marcas. El aislamiento solo puede venir de auth.* (del JWT firmado).
    expect(streams).not.toMatch(/connection\.parameter/);
    expect(streams).not.toMatch(/subscription\.parameter/);
  });

  it("exige el segundo factor en la bajada (gate aal2, MAR-71)", () => {
    // El gate aal2 de la RLS no cubre lo que PowerSync descarga: hay que exigir
    // el claim aal en la propia regla, o una sesión aal1 recibe datos igual.
    expect(streams).toMatch(/auth\.parameter\('aal'\)\s*=\s*'aal2'/);
  });

  it("exige acceso efectivo: usuario activo y su cliente activo", () => {
    // Espeja app.perfil_efectivo(): si el cliente se cancela, deja de replicar.
    expect(streams).toMatch(/p\.activo\s*=\s*true/);
    expect(streams).toMatch(/t\.activo\s*=\s*true/);
  });
});
