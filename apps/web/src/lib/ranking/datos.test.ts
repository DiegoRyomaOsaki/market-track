import { beforeEach, describe, expect, it, vi } from "vitest";

import { type OpcionesFalso, supabaseFalso } from "@/lib/panel/supabase-falso";

import { datosDeDetalle, datosDeRanking } from "./datos";

// Lo que se prueba de esta capa es el CONTRATO con la base: qué parámetros
// viajan a la RPC (quien autoriza es ella), qué tipo de periodo se usa cuando
// nadie eligió uno, y que un fallo de carga se distingue de un vacío.

const { estado } = vi.hoisted(() => {
  const estado: {
    opciones: OpcionesFalso;
    espias: ReturnType<typeof supabaseFalso> | null;
  } = { opciones: {}, espias: null };
  return { estado };
});

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => {
    estado.espias = supabaseFalso(estado.opciones);
    return Promise.resolve(estado.espias.cliente);
  },
}));

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const MERCADERISTA = "44444444-4444-4444-4444-444444444444";

beforeEach(() => {
  estado.opciones = {};
  estado.espias = null;
});

describe("datosDeRanking", () => {
  it("manda a la RPC el tenant, el tipo elegido y el inicio ALINEADO", async () => {
    estado.opciones = {
      lecturas: {
        config_perfect_merchandiser: [
          { tenant_id: TENANT, periodicidad: "mensual" },
        ],
      },
      rpc: { data: [], error: null },
    };

    // Un `?periodo=2026-07-15` mensual consulta julio, no media ventana.
    await datosDeRanking(TENANT, "mensual", "2026-07-15", "2026-08-21");

    expect(estado.espias?.rpcsPedidas[0]).toEqual({
      nombre: "ranking_merchandiser",
      argumentos: {
        p_tenant: TENANT,
        p_tipo: "mensual",
        p_inicio: "2026-07-01",
      },
    });
  });

  it("sin tipo elegido usa la PERIODICIDAD configurada del cliente", async () => {
    estado.opciones = {
      lecturas: {
        config_perfect_merchandiser: [
          { tenant_id: TENANT, periodicidad: "trimestral" },
        ],
      },
      rpc: { data: [], error: null },
    };

    const r = await datosDeRanking(TENANT, null, null, "2026-08-21");

    expect(r.tipo).toBe("trimestral");
    expect(r.inicio).toBe("2026-07-01");
    expect(estado.espias?.rpcsPedidas[0]?.argumentos).toMatchObject({
      p_tipo: "trimestral",
    });
  });

  it("un cliente sin configuración se dice (`hayConfig`), no se confunde con un error", async () => {
    estado.opciones = {
      lecturas: { config_perfect_merchandiser: [] },
      rpc: { data: [], error: null },
    };

    const r = await datosDeRanking(TENANT, null, null, "2026-08-21");

    expect(r.hayConfig).toBe(false);
    expect(r.error).toBeNull();
  });

  it("un fallo de la RPC devuelve `error`, no un ranking vacío", async () => {
    estado.opciones = {
      lecturas: {
        config_perfect_merchandiser: [
          { tenant_id: TENANT, periodicidad: "mensual" },
        ],
      },
      rpc: { error: { message: "permission denied", code: "42501" } },
    };

    const r = await datosDeRanking(TENANT, "mensual", null, "2026-08-21");

    expect(r.error).not.toBeNull();
    expect(r.filas).toEqual([]);
  });
});

describe("datosDeDetalle", () => {
  it("manda a la RPC de paradas el mercaderista y el periodo", async () => {
    estado.opciones = {
      perfiles: [{ id: MERCADERISTA, nombre: "José Quispe" }],
      lecturas: { puntaje_merchandiser: [] },
      rpc: { data: [], error: null },
    };

    await datosDeDetalle(MERCADERISTA, "mensual", "2026-07-01");

    expect(estado.espias?.rpcsPedidas[0]).toEqual({
      nombre: "paradas_del_periodo_merchandiser",
      argumentos: {
        p_mercaderista: MERCADERISTA,
        p_tipo: "mensual",
        p_inicio: "2026-07-01",
      },
    });
  });

  it("un periodo sin calcular devuelve `puntaje` null con el nombre resuelto", async () => {
    estado.opciones = {
      perfiles: [{ id: MERCADERISTA, nombre: "José Quispe" }],
      lecturas: { puntaje_merchandiser: [] },
      rpc: { data: [], error: null },
    };

    const r = await datosDeDetalle(MERCADERISTA, "mensual", "2026-07-01");

    expect(r.nombre).toBe("José Quispe");
    expect(r.puntaje).toBeNull();
    expect(r.error).toBeNull();
  });

  it("un fallo de carga devuelve `error`, nunca un detalle a medias", async () => {
    estado.opciones = {
      perfiles: [{ id: MERCADERISTA, nombre: "José Quispe" }],
      lecturas: { puntaje_merchandiser: [] },
      rpc: { error: { message: "permission denied", code: "42501" } },
    };

    const r = await datosDeDetalle(MERCADERISTA, "mensual", "2026-07-01");

    expect(r.error).not.toBeNull();
    expect(r.nombre).toBeNull();
    expect(r.paradas).toEqual([]);
  });
});
