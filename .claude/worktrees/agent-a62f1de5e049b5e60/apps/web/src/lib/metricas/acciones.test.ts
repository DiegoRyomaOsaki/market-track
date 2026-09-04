import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseFalso } from "@/lib/panel/supabase-falso";

import {
  previsualizarMerchandiser,
  previsualizarPerfectStore,
  publicarConfigMerchandiser,
  publicarConfigPerfectStore,
  publicarEscaleraBono,
} from "./acciones";

// Lo que estas acciones tienen que hacer bien no es escribir —de eso responde la
// RLS, y `packages/db/test/panel-metricas.db.test.ts` la prueba contra Postgres
// de verdad— sino TRADUCIR: cada código del motor tiene que llegar al admin
// diciéndole qué corregir, nunca como el mensaje crudo del driver.

const { cliente } = vi.hoisted(() => ({
  cliente: { actual: null as object | null },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => Promise.resolve(cliente.actual),
}));

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const MARCA = "cccccccc-0000-0000-0000-000000000001";

const CONFIG_PS = {
  tenant_id: TENANT,
  marca_id: MARCA,
  categoria_id: null,
  tipo_tienda: null,
  peso_distribucion: 30,
  peso_visibilidad: 25,
  peso_precio: 25,
  peso_pop: 10,
  peso_orden: 10,
  sos_objetivo_pct: 35,
  sos_unidad: "frentes",
  politica_pop: "dentro_del_tope",
  orden_bien_pts: 100,
  orden_regular_pts: 50,
  orden_mal_pts: 0,
  vigente_desde: "2026-09-01",
};

const CONFIG_PM = {
  tenant_id: TENANT,
  peso_puntualidad: 25,
  peso_asistencia: 30,
  peso_tiempo_efectivo: 0,
  peso_calidad: 25,
  peso_herramientas: 20,
  tolerancia_puntualidad_min: 15,
  minutos_tardanza_cero: 60,
  dias_gracia_cierre: 7,
  periodicidad: "mensual",
  vigente_desde: "2026-09-01",
};

const ESCALERA = {
  tenant_id: TENANT,
  vigente_desde: "2026-09-01",
  niveles: [{ nombre: "Bronce", puntaje_min: 60, monto: 100 }],
};

const PESOS_PS = {
  peso_distribucion: 30,
  peso_visibilidad: 25,
  peso_precio: 25,
  peso_pop: 10,
  peso_orden: 10,
};

const PESOS_PM = {
  peso_puntualidad: 25,
  peso_asistencia: 30,
  peso_tiempo_efectivo: 0,
  peso_calidad: 25,
  peso_herramientas: 20,
};

function conRespuesta(opciones: Parameters<typeof supabaseFalso>[0]) {
  const falso = supabaseFalso(opciones);
  cliente.actual = falso.cliente;
  return falso;
}

const OK = { data: [{ id: "nuevo" }], error: null };

beforeEach(() => {
  vi.restoreAllMocks();
  conRespuesta({ escritura: OK });
});

describe("publicarConfigPerfectStore", () => {
  it("manda a la tabla los campos validados", () => {
    const falso = conRespuesta({ escritura: OK });
    return publicarConfigPerfectStore(CONFIG_PS).then((r) => {
      expect(r.ok).toBe(true);
      expect(falso.tablasPedidas).toContain("config_perfect_store");
    });
  });

  it("rechaza unos pesos que no suman 100 SIN tocar la base", () => {
    const falso = conRespuesta({ escritura: OK });
    return publicarConfigPerfectStore({
      ...CONFIG_PS,
      peso_distribucion: 50,
    }).then((r) => {
      expect(r.ok).toBe(false);
      expect(falso.tablasPedidas).not.toContain("config_perfect_store");
    });
  });

  it("un duplicado se explica en términos del formulario", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    conRespuesta({
      escritura: {
        data: null,
        error: {
          message: "duplicate key value ... config_ps_natural_uq",
          code: "23505",
        },
      },
    });

    const r = await publicarConfigPerfectStore(CONFIG_PS);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/alcance y esa fecha/i);
    // El mensaje del motor habla de índices: al admin no se le enseña crudo.
    expect(r.error).not.toMatch(/duplicate key/i);
  });

  it("un insert que la RLS bloquea no pasa por éxito", async () => {
    // La pitfall del proyecto: un INSERT bloqueado por RLS no da error, afecta a
    // 0 filas y devuelve éxito. Solo `.select()` vacío lo delata.
    conRespuesta({ escritura: { data: [], error: null } });

    const r = await publicarConfigPerfectStore(CONFIG_PS);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/sin permiso/i);
  });

  it("un fallo de infraestructura no llega crudo al navegador", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    conRespuesta({
      escritura: {
        data: null,
        error: {
          message: `connection to server at 10.0.0.1 failed: password=${"x".repeat(400)}`,
        },
      },
    });

    const r = await publicarConfigPerfectStore(CONFIG_PS);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("No se pudo publicar la configuración");
    expect(r.error).not.toMatch(/password/);
    // Y en el log va recortado: el mensaje del driver puede arrastrar la
    // respuesta entera.
    const escrito = String(log.mock.calls[0]?.[1] ?? "");
    expect(escrito.length).toBeLessThanOrEqual(200);
  });
});

describe("publicarConfigMerchandiser", () => {
  it("publica una configuración válida", () => {
    const falso = conRespuesta({ escritura: OK });
    return publicarConfigMerchandiser(CONFIG_PM).then((r) => {
      expect(r.ok).toBe(true);
      expect(falso.tablasPedidas).toContain("config_perfect_merchandiser");
    });
  });

  it("no deja darle peso al tiempo efectivo de atención", () => {
    const falso = conRespuesta({ escritura: OK });
    return publicarConfigMerchandiser({
      ...CONFIG_PM,
      peso_tiempo_efectivo: 20,
      peso_herramientas: 0,
    }).then((r) => {
      expect(r.ok).toBe(false);
      expect(falso.tablasPedidas).not.toContain("config_perfect_merchandiser");
    });
  });

  it("una fecha repetida se explica sin hablar de índices", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    conRespuesta({
      escritura: {
        data: null,
        error: { message: "duplicate key ...", code: "23505" },
      },
    });
    const r = await publicarConfigMerchandiser(CONFIG_PM);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/vigente desde esa fecha/i);
  });
});

describe("publicarEscaleraBono", () => {
  it("va por la RPC, no por un insert directo", () => {
    // El insert directo tiene éxito y FUSIONA la escalera con la que ya hubiera
    // en esa fecha; la RPC es la que lo rechaza.
    const falso = conRespuesta({ escritura: OK, rpc: { error: null } });
    return publicarEscaleraBono(ESCALERA).then((r) => {
      expect(r.ok).toBe(true);
      expect(falso.rpcsPedidas.map((x) => x.nombre)).toContain(
        "publicar_escalera_bono",
      );
      expect(falso.tablasPedidas).not.toContain("nivel_bono_merchandiser");
    });
  });

  it("una fecha que ya tiene escalera dice cuál es el arreglo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    conRespuesta({
      escritura: OK,
      rpc: {
        error: { message: "ya hay una escalera...", code: "23514" },
      },
    });
    const r = await publicarEscaleraBono(ESCALERA);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/elige otra fecha/i);
  });

  it("sin permiso se distingue de un fallo del sistema", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    conRespuesta({
      escritura: OK,
      rpc: { error: { message: "permission denied", code: "42501" } },
    });
    const r = await publicarEscaleraBono(ESCALERA);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/sin permiso/i);
  });

  it("dos peldaños en el mismo umbral no llegan a la base", () => {
    const falso = conRespuesta({ escritura: OK, rpc: { error: null } });
    return publicarEscaleraBono({
      ...ESCALERA,
      niveles: [
        { nombre: "A", puntaje_min: 60, monto: 100 },
        { nombre: "B", puntaje_min: 60, monto: 200 },
      ],
    }).then((r) => {
      expect(r.ok).toBe(false);
      expect(falso.rpcsPedidas).toHaveLength(0);
    });
  });
});

describe("las vistas previas validan su entrada", () => {
  // Una Server Action es un endpoint POST alcanzable sin pasar por el
  // formulario: los parámetros no son de fiar solo porque la pantalla los
  // construya bien.
  it("un id que no es uuid no llega a la base", () => {
    const falso = conRespuesta({ escritura: OK, rpc: { error: null } });
    return previsualizarPerfectStore("no-es-un-uuid", PESOS_PS).then((r) => {
      expect(r.ok).toBe(false);
      expect(falso.rpcsPedidas).toHaveLength(0);
    });
  });

  it("unos pesos con forma inesperada tampoco", () => {
    const falso = conRespuesta({ escritura: OK, rpc: { error: null } });
    return previsualizarMerchandiser(TENANT, { peso_puntualidad: 999 }).then(
      (r) => {
        expect(r.ok).toBe(false);
        expect(falso.rpcsPedidas).toHaveLength(0);
      },
    );
  });

  it("con datos válidos llama a la RPC y devuelve la comparación", async () => {
    conRespuesta({
      escritura: OK,
      rpc: {
        data: [
          {
            tienda_nombre: "Plaza Vea",
            calculado_at: "2026-08-01T12:00:00Z",
            total_actual: 80,
            total_previsto: 92,
          },
        ],
        error: null,
      },
    });

    const r = await previsualizarPerfectStore(MARCA, PESOS_PS);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.previa?.actual).toBe(80);
    expect(r.previa?.previsto).toBe(92);
    expect(r.previa?.etiqueta).toBe("Plaza Vea");
  });

  it("sin puntajes devuelve una previa nula, no un error", () => {
    // De eso depende que la pantalla explique por qué está vacía en vez de
    // enseñar una alerta roja.
    conRespuesta({ escritura: OK, rpc: { data: [], error: null } });
    return previsualizarMerchandiser(TENANT, PESOS_PM).then((r) => {
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.previa).toBeNull();
    });
  });
});
