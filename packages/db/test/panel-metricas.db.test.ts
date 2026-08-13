import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// Lo que el panel necesita para configurar las dos métricas: publicar una
// escalera de bonos entera y previsualizar el efecto de unos pesos sin guardar.
//
// El caso que justifica la RPC de publicación: sin ella, publicar sobre una
// fecha que ya tiene escalera no falla — FUSIONA las dos, y como no hay `delete`
// para `authenticated`, no se puede deshacer desde el panel.

const MARCA_MRC = "cccccccc-0000-0000-0000-000000000001";
const LEVANTAMIENTO_MRC = "a0000011-0000-0000-0000-000000000001";
const CONFIG_PS_MRC = "a0000019-0000-0000-0000-000000000001";

const PESOS_PS = {
  peso_distribucion: 50,
  peso_visibilidad: 25,
  peso_precio: 25,
  peso_pop: 0,
  peso_orden: 0,
};
const PESOS_PM = {
  peso_puntualidad: 40,
  peso_asistencia: 30,
  peso_tiempo_efectivo: 0,
  peso_calidad: 20,
  peso_herramientas: 10,
};

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

/** Un peldaño de escalera, en la forma que espera la RPC. */
function nivel(nombre: string, puntaje_min: number, monto: number) {
  return { nombre, puntaje_min, monto };
}

async function publicar(
  c: Client,
  fecha: string,
  niveles: ReturnType<typeof nivel>[],
  tenant: string = TENANTS.maracumango,
) {
  return c.query<{ publicar_escalera_bono: number }>(
    `select public.publicar_escalera_bono($1, $2, $3::jsonb)`,
    [tenant, fecha, JSON.stringify(niveles)],
  );
}

/** Un puntaje de Perfect Store ya calculado, para tener qué re-ponderar. */
async function conPuntajePs(
  c: Client,
  levantamiento: string,
  tenant: string,
  config: string,
): Promise<void> {
  await c.query("set local role postgres");
  await c.query(
    `insert into public.puntaje_perfect_store
       (levantamiento_id, tenant_id, config_id,
        distribucion_pct, visibilidad_pct, precio_pct, total_pct)
     values ($1, $2, $3, 80, 60, 100, 80)
     on conflict (levantamiento_id) do update set total_pct = excluded.total_pct`,
    [levantamiento, tenant, config],
  );
  await c.query("set local role authenticated");
}

describe("publicar_escalera_bono — una escalera es un conjunto, no filas sueltas", () => {
  it("publica todos los peldaños de una vez", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await publicar(c, "2026-09-01", [
        nivel("Bronce", 60, 100),
        nivel("Plata", 80, 250),
      ]);
      expect(r.rows[0]?.publicar_escalera_bono).toBe(2);
    });
  });

  it("RECHAZA una fecha que ya tiene escalera: publicar sobre ella la fusiona", async () => {
    // El bug que esta RPC existe para cerrar. Medido antes de escribirla: la
    // clave natural es (tenant, vigente_desde, puntaje_min), así que dos
    // escaleras con umbrales distintos conviven en la misma fecha y
    // `nivel_bono_aplicable` resuelve sobre la mezcla. Y sin `delete` para
    // `authenticated`, desde el panel no hay forma de deshacerlo.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await expect(
        publicar(c, "2026-01-01", [nivel("Nuevo bajo", 50, 10)]),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("la escalera anterior queda intacta al publicar una nueva", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await publicar(c, "2026-09-01", [nivel("Único", 50, 999)]);
      const enero = await c.query<{ n: string }>(
        `select count(*)::text as n from public.nivel_bono_merchandiser
         where tenant_id = $1 and vigente_desde = '2026-01-01'`,
        [TENANTS.maracumango],
      );
      // Los tres peldaños del seed siguen ahí: el histórico no se reescribe.
      expect(enero.rows[0]?.n).toBe("3");
    });
  });

  it("un peldaño inválido no deja media escalera publicada", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await expect(
        publicar(c, "2026-09-01", [
          nivel("Bueno", 60, 100),
          nivel("Imposible", 150, 100),
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("una escalera vacía se rechaza: dejaría al cliente sin bonos", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await expect(publicar(c, "2026-09-01", [])).rejects.toMatchObject({
        code: "23514",
      });
    });
  });

  it("el supervisor NO publica: lo para la RLS, no la pantalla", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await expect(
        publicar(c, "2026-09-01", [nivel("Intruso", 60, 100)]),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("el mercaderista tampoco", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await expect(
        publicar(c, "2026-09-01", [nivel("Intruso", 60, 100)]),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
});

describe("previsualizar_perfect_store", () => {
  it("da el MISMO número que el ponderador que envuelve", async () => {
    // La envoltura existe solo porque el esquema `app` no está expuesto por
    // PostgREST. Si introdujera una segunda cuenta, la previa mentiría sobre el
    // puntaje que luego produce el motor.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await conPuntajePs(
        c,
        LEVANTAMIENTO_MRC,
        TENANTS.maracumango,
        CONFIG_PS_MRC,
      );

      const previa = await c.query<{ total_previsto: string }>(
        `select total_previsto from public.previsualizar_perfect_store($1, $2::jsonb)`,
        [MARCA_MRC, JSON.stringify(PESOS_PS)],
      );
      const directo = await c.query<{ p: string }>(
        `select app.ponderar_perfect_store(
           jsonb_populate_record(null::public.config_perfect_store, $1::jsonb),
           80, 60, 100) as p`,
        [JSON.stringify(PESOS_PS)],
      );
      expect(previa.rows[0]?.total_previsto).toBe(directo.rows[0]?.p);
    });
  });

  it("devuelve el actual y el previsto para poder compararlos", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await conPuntajePs(
        c,
        LEVANTAMIENTO_MRC,
        TENANTS.maracumango,
        CONFIG_PS_MRC,
      );
      const r = await c.query<{
        total_actual: string;
        total_previsto: string;
        tienda_nombre: string;
      }>(
        `select total_actual, total_previsto, tienda_nombre
         from public.previsualizar_perfect_store($1, $2::jsonb)`,
        [MARCA_MRC, JSON.stringify(PESOS_PS)],
      );
      expect(r.rows[0]?.total_actual).toBe("80.00");
      // 50*80 + 25*60 + 25*100 = 8000 / 100 = 80.00 — mismos pesos, mismo número.
      expect(r.rows[0]?.total_previsto).toBe("80.00");
      expect(r.rows[0]?.tienda_nombre).toBeTruthy();
    });
  });

  it("unos pesos distintos mueven el previsto y NO tocan el actual", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await conPuntajePs(
        c,
        LEVANTAMIENTO_MRC,
        TENANTS.maracumango,
        CONFIG_PS_MRC,
      );
      const r = await c.query<{ total_actual: string; total_previsto: string }>(
        `select total_actual, total_previsto
         from public.previsualizar_perfect_store($1, $2::jsonb)`,
        [
          MARCA_MRC,
          JSON.stringify({
            ...PESOS_PS,
            peso_distribucion: 100,
            peso_visibilidad: 0,
            peso_precio: 0,
          }),
        ],
      );
      expect(r.rows[0]?.total_previsto).toBe("80.00");
      expect(r.rows[0]?.total_actual).toBe("80.00");

      // Y la fila guardada sigue como estaba: una previa no escribe nada.
      const guardado = await c.query<{ total_pct: string }>(
        `select total_pct from public.puntaje_perfect_store where levantamiento_id = $1`,
        [LEVANTAMIENTO_MRC],
      );
      expect(guardado.rows[0]?.total_pct).toBe("80.00");
    });
  });

  it("sin puntajes devuelve CERO filas, no una fila de nulos", async () => {
    // De esto depende el estado vacío de la pantalla: una fila con nulos se
    // pintaría como "previsto: —" en vez de explicar que no hay nada que
    // re-ponderar.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await c.query(
        `select * from public.previsualizar_perfect_store($1, $2::jsonb)`,
        [MARCA_MRC, JSON.stringify(PESOS_PS)],
      );
      expect(r.rowCount).toBe(0);
    });
  });

  it("el cliente-marca del rival no ve el puntaje de Maracumango", async () => {
    // La función es `security invoker` y no lleva ni un filtro de tenant
    // escrito a mano: quien acota es la RLS. Este test es lo único que lo
    // demuestra.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await conPuntajePs(
        c,
        LEVANTAMIENTO_MRC,
        TENANTS.maracumango,
        CONFIG_PS_MRC,
      );
      await c.query(
        `set local request.jwt.claims = '${JSON.stringify({
          sub: USUARIOS.mercaderistaRival,
          role: "authenticated",
          aal: "aal2",
        })}'`,
      );
      const r = await c.query(
        `select * from public.previsualizar_perfect_store($1, $2::jsonb)`,
        [MARCA_MRC, JSON.stringify(PESOS_PS)],
      );
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("previsualizar_merchandiser", () => {
  async function conPuntajePm(c: Client): Promise<void> {
    await c.query("set local role postgres");
    await c.query(
      `insert into public.puntaje_merchandiser
         (mercaderista_id, tipo, periodo_inicio, tenant_id, config_id,
          puntualidad_pct, asistencia_pct, calidad_pct, herramientas_pct, total_pct)
       values ($1, 'mensual', '2026-02-01', $2, $3, 90, 100, 80, 60, 85)`,
      [
        USUARIOS.mercaderistaMaracumango,
        TENANTS.maracumango,
        "a0000021-0000-0000-0000-000000000001",
      ],
    );
    await c.query("set local role authenticated");
  }

  it("re-pondera el periodo más reciente y trae quién es", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await conPuntajePm(c);
      const r = await c.query<{
        mercaderista: string;
        total_actual: string;
        total_previsto: string;
        tipo: string;
      }>(
        `select mercaderista, total_actual, total_previsto, tipo
         from public.previsualizar_merchandiser($1, $2::jsonb)`,
        [TENANTS.maracumango, JSON.stringify(PESOS_PM)],
      );
      expect(r.rows[0]?.total_actual).toBe("85.00");
      // 40*90 + 30*100 + 20*80 + 10*60 = 3600+3000+1600+600 = 8800 / 100 = 88.00
      expect(r.rows[0]?.total_previsto).toBe("88.00");
      expect(r.rows[0]?.mercaderista).toBeTruthy();
      expect(r.rows[0]?.tipo).toBe("mensual");
    });
  });

  it("una variable no evaluada renormaliza también en la previa", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query("set local role postgres");
      await c.query(
        `insert into public.puntaje_merchandiser
           (mercaderista_id, tipo, periodo_inicio, tenant_id, config_id,
            puntualidad_pct, asistencia_pct, total_pct)
         values ($1, 'mensual', '2026-03-01', $2, $3, 100, 50, 70)`,
        [
          USUARIOS.mercaderistaMaracumango,
          TENANTS.maracumango,
          "a0000021-0000-0000-0000-000000000001",
        ],
      );
      await c.query("set local role authenticated");

      const r = await c.query<{ total_previsto: string }>(
        `select total_previsto from public.previsualizar_merchandiser($1, $2::jsonb)`,
        [TENANTS.maracumango, JSON.stringify(PESOS_PM)],
      );
      // Solo puntualidad (40) y asistencia (30) evaluadas:
      // (40*100 + 30*50) / 70 = 5500/70 = 78.57
      expect(r.rows[0]?.total_previsto).toBe("78.57");
    });
  });

  it("sin periodos calculados devuelve cero filas", async () => {
    // Es el estado POR DEFECTO hoy: nada invoca todavía el recálculo del plan
    // de lealtad, así que la pantalla tiene que explicar por qué está vacía.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await c.query(
        `select * from public.previsualizar_merchandiser($1, $2::jsonb)`,
        [TENANTS.maracumango, JSON.stringify(PESOS_PM)],
      );
      expect(r.rowCount).toBe(0);
    });
  });

  it("el cliente-marca no ve el plan de lealtad ni por la previa", async () => {
    // El puntaje del mercaderista es dato laboral: el cliente no tiene política
    // de lectura sobre `puntaje_merchandiser`, y la previa hereda esa verja.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await conPuntajePm(c);
      await c.query(
        `set local request.jwt.claims = '${JSON.stringify({
          sub: USUARIOS.clienteMaracumango,
          role: "authenticated",
          aal: "aal2",
        })}'`,
      );
      const r = await c.query(
        `select * from public.previsualizar_merchandiser($1, $2::jsonb)`,
        [TENANTS.maracumango, JSON.stringify(PESOS_PM)],
      );
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("periodicidad del plan de lealtad", () => {
  it("la configuración vigente la devuelve, con 'mensual' de defecto", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await c.query<{ periodicidad: string }>(
        `select (app.config_perfect_merchandiser_aplicable($1, '2026-06-01')).periodicidad`,
        [TENANTS.maracumango],
      );
      expect(r.rows[0]?.periodicidad).toBe("mensual");
    });
  });

  it("se puede publicar una configuración trimestral", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query(
        `insert into public.config_perfect_merchandiser
           (tenant_id, peso_puntualidad, peso_asistencia, peso_tiempo_efectivo,
            peso_calidad, peso_herramientas, tolerancia_puntualidad_min,
            periodicidad, vigente_desde)
         values ($1, 25, 30, 0, 25, 20, 15, 'trimestral', '2026-07-01')`,
        [TENANTS.maracumango],
      );
      const r = await c.query<{ periodicidad: string }>(
        `select (app.config_perfect_merchandiser_aplicable($1, '2026-08-01')).periodicidad`,
        [TENANTS.maracumango],
      );
      expect(r.rows[0]?.periodicidad).toBe("trimestral");
    });
  });
});
