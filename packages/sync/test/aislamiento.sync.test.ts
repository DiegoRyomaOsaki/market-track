import { beforeAll, describe, expect, it } from "vitest";

import {
  conTenantDesactivado,
  filasReplicadas,
  replicarCon,
  sesionAal1,
  sesionAal2,
  USUARIOS,
} from "./ayudas";

// La segunda superficie de seguridad del producto: lo que el móvil DESCARGA.
// No pasa por RLS (PowerSync replica con BYPASSRLS), así que se prueba aquí,
// conectando clientes reales y afirmando qué filas llegan.
//
// Prerrequisitos: `supabase start`, `supabase functions serve` y
// `pnpm --filter @market-track/sync sync:up`. Sin ellos el harness no corre.

const TABLAS = ["tienda", "sku", "cadena", "marca", "visita"] as const;

describe("aislamiento de las sync rules", () => {
  beforeAll(() => {
    if (!process.env.ANON_KEY) {
      throw new Error(
        "Falta ANON_KEY. Corre el harness con la anon key del Supabase local en el entorno.",
      );
    }
  });

  it("un mercaderista solo replica los datos de SU cliente", async () => {
    const sesion = await sesionAal2(USUARIOS.joseMaracumango.email);
    const tiendas = await filasReplicadas(sesion, "tienda");

    expect(tiendas.length).toBeGreaterThan(0); // sí baja algo
    // Y TODO es de su tenant: ni una fila del otro cliente.
    const ajenas = tiendas.filter(
      (t) => t.tenant_id !== USUARIOS.joseMaracumango.tenant,
    );
    expect(ajenas).toEqual([]);
  }, 60000);

  it("dos mercaderistas de clientes distintos no ven lo del otro", async () => {
    const jose = await sesionAal2(USUARIOS.joseMaracumango.email);
    const rival = await sesionAal2(USUARIOS.mercaRival.email);

    const tiendasJose = await filasReplicadas(jose, "tienda");
    const tiendasRival = await filasReplicadas(rival, "tienda");

    // Ninguna tienda de José aparece para el mercaderista Rival, ni al revés.
    for (const t of tiendasJose) {
      expect(t.tenant_id).toBe(USUARIOS.joseMaracumango.tenant);
    }
    for (const t of tiendasRival) {
      expect(t.tenant_id).toBe(USUARIOS.mercaRival.tenant);
    }
  }, 90000);

  it("una sesión aal1 (sin segundo factor) NO replica NADA — MAR-71", async () => {
    // El hallazgo de MAR-71: el gate aal2 vive en la RLS y no cubre la bajada.
    // La sync rule lo exige explícitamente (auth.parameter('aal') = 'aal2'), así
    // que sin completar el 2FA no debe bajar ni una fila.
    const sesion = await sesionAal1(USUARIOS.joseMaracumango.email);
    const conteo = await replicarCon(sesion, TABLAS);

    for (const t of TABLAS) {
      expect(conteo[t]).toBe(0);
    }
  }, 60000);

  it("un excliente deja de replicar en cuanto se desactiva su cliente", async () => {
    // El acceso es DERIVADO: el CTE mi_tenant exige t.activo = true. Al apagar el
    // cliente, deja de devolver tenant y no baja nada.
    const sesion = await sesionAal2(USUARIOS.joseMaracumango.email);

    // Con el cliente activo, sí replica.
    const antes = await replicarCon(sesion, ["tienda"]);
    expect(antes.tienda).toBeGreaterThan(0);

    // Apagado el cliente, una sesión NUEVA no recibe nada.
    await conTenantDesactivado(USUARIOS.joseMaracumango.tenant, async () => {
      const sesion2 = await sesionAal2(USUARIOS.joseMaracumango.email);
      const durante = await replicarCon(sesion2, ["tienda"]);
      expect(durante.tienda).toBe(0);
    });
  }, 120000);
});
