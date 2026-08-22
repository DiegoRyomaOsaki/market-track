import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// El ranking del plan de lealtad: la ventana de posiciones y su frontera de
// autorización. El CÁLCULO del puntaje es del motor y se prueba en
// `perfect-merchandiser.db.test.ts`; aquí se siembra `puntaje_merchandiser`
// directamente y se prueba lo que el ranking hace con él.
//
// Los dos criterios que aquí se fijan:
//   · el supervisor solo ve a su equipo, PERO con las posiciones del cliente
//     entero (la ventana corre antes que la visibilidad);
//   · «sin datos» no es un cero: queda sin posición y no desplaza a nadie.

const CONFIG_SEED = "a0000021-0000-0000-0000-000000000001";
const NIVEL_PLATA = "a0000022-0000-0000-0000-000000000002";

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

type FilaRanking = {
  mercaderista_id: string;
  nombre: string;
  activo: boolean;
  posicion: number | null;
  hay_empate: boolean;
  total_pct: string | null;
  nivel_bono: string | null;
  nivel_bono_monto: string | null;
  cerrado: boolean;
  cierre_bloqueado: boolean;
  total_anterior: string | null;
  posicion_anterior: number | null;
  config_distinta: boolean;
};

/** Un id irrepetible por caso: cada test siembra el suyo y hace rollback. */
function id(prefijo: string, sufijo: string): string {
  return `e500000${prefijo}-0000-0000-0000-0000000000${sufijo}`;
}

/**
 * Un mercaderista nuevo del cliente del seed, con el supervisor que se pida.
 * `profile.id` referencia `auth.users`, así que la fila de auth va primero —
 * con los tokens en '' y no NULL, la trampa documentada del seed.
 */
async function conMercaderista(
  c: Client,
  sufijo: string,
  supervisorId: string | null,
  activo = true,
): Promise<string> {
  const usuario = id("1", sufijo);
  await c.query("set local role postgres");
  await c.query(
    `insert into auth.users (
       instance_id, id, aud, role, email, email_confirmed_at, created_at,
       updated_at, raw_app_meta_data, raw_user_meta_data,
       confirmation_token, recovery_token, email_change,
       email_change_token_new, email_change_token_current,
       phone_change, phone_change_token, reauthentication_token)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated',
             'authenticated', $2, now(), now(), now(),
             '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '')`,
    [usuario, `rk-${sufijo}@markettrack.pe`],
  );
  await c.query(
    `insert into public.profile (id, rol, tenant_id, nombre, dni, supervisor_id, activo)
     values ($1, 'mercaderista', $2, $3, $4, $5, $6)`,
    [
      usuario,
      TENANTS.maracumango,
      `Merca Ranking ${sufijo}`,
      `9${sufijo}00000`.slice(0, 8),
      supervisorId,
      activo,
    ],
  );
  await c.query("set local role authenticated");
  return usuario;
}

/** Un puntaje sembrado a mano: aquí se prueba el ranking, no el motor. */
async function conPuntaje(
  c: Client,
  mercaderista: string,
  inicio: string,
  total: number | null,
  opciones: {
    tipo?: "mensual" | "trimestral" | "anual";
    nivelId?: string | null;
    configId?: string;
    cerrado?: boolean;
    bloqueado?: boolean;
  } = {},
): Promise<void> {
  await c.query("set local role postgres");
  await c.query(
    `insert into public.puntaje_merchandiser
       (mercaderista_id, tipo, periodo_inicio, tenant_id, config_id,
        nivel_bono_id, total_pct, puntualidad_pct, calculado_at, cerrado_at,
        cierre_bloqueado)
     values ($1, $2, $3, $4, $5, $6, $7, $7, now(),
             case when $8 then now() end, $9)`,
    [
      mercaderista,
      opciones.tipo ?? "mensual",
      inicio,
      TENANTS.maracumango,
      opciones.configId ?? CONFIG_SEED,
      opciones.nivelId ?? null,
      total,
      opciones.cerrado ?? false,
      opciones.bloqueado ?? false,
    ],
  );
  await c.query("set local role authenticated");
}

async function ranking(
  c: Client,
  inicio = "2026-07-01",
  tipo = "mensual",
  tenant: string = TENANTS.maracumango,
): Promise<FilaRanking[]> {
  const r = await c.query<FilaRanking>(
    `select mercaderista_id, nombre, activo, posicion, hay_empate, total_pct,
            nivel_bono, nivel_bono_monto, cerrado, cierre_bloqueado,
            total_anterior, posicion_anterior, config_distinta
     from public.ranking_merchandiser($1, $2::public.periodo_puntaje, $3)`,
    [tenant, tipo, inicio],
  );
  return r.rows;
}

/** El SQLSTATE de una llamada que debe fallar, sin abortar la transacción. */
async function codigoDeError(c: Client, sql: string): Promise<string> {
  await c.query("savepoint intento");
  try {
    await c.query(sql);
    await c.query("release savepoint intento");
    return "";
  } catch (err) {
    await c.query("rollback to savepoint intento");
    return (err as { code?: string }).code ?? "";
  }
}

describe("orden, empates y sin-datos", () => {
  it("empata con rango de COMPETICIÓN: 91/88/88/74 → 1, 2, 2, 4", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const a = await conMercaderista(c, "01", USUARIOS.supervisor);
      const b = await conMercaderista(c, "02", USUARIOS.supervisor);
      const d = await conMercaderista(c, "03", USUARIOS.supervisor);
      const e = await conMercaderista(c, "04", USUARIOS.supervisor);
      await conPuntaje(c, a, "2026-07-01", 91);
      await conPuntaje(c, b, "2026-07-01", 88);
      await conPuntaje(c, d, "2026-07-01", 88);
      await conPuntaje(c, e, "2026-07-01", 74);

      const filas = await ranking(c);
      const posiciones = new Map(
        filas.map((f) => [f.mercaderista_id, f.posicion]),
      );

      expect(posiciones.get(a)).toBe(1);
      expect(posiciones.get(b)).toBe(2);
      expect(posiciones.get(d)).toBe(2);
      // Rango de competición, no denso: tras dos segundos viene el CUARTO.
      expect(posiciones.get(e)).toBe(4);

      const empatados = filas.filter((f) => f.posicion === 2);
      expect(empatados.every((f) => f.hay_empate)).toBe(true);
      expect(filas.find((f) => f.mercaderista_id === a)?.hay_empate).toBe(
        false,
      );
    });
  });

  it("«sin datos» queda SIN posición, al final, y no desplaza a nadie", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const conDatos = await conMercaderista(c, "05", USUARIOS.supervisor);
      const sinDatos = await conMercaderista(c, "06", USUARIOS.supervisor);
      await conPuntaje(c, conDatos, "2026-07-01", 74);

      const filas = await ranking(c);
      const elSin = filas.find((f) => f.mercaderista_id === sinDatos);
      const elCon = filas.find((f) => f.mercaderista_id === conDatos);

      expect(elSin?.posicion).toBeNull();
      expect(elSin?.total_pct).toBeNull();
      // El 74 sigue siendo el mejor puntaje sembrado por ESTE test: nadie con
      // NULL le roba la posición.
      expect(elCon?.posicion).toBe(1);
      // Y los sin-datos van después de los posicionados.
      const idxCon = filas.findIndex((f) => f.mercaderista_id === conDatos);
      const idxSin = filas.findIndex((f) => f.mercaderista_id === sinDatos);
      expect(idxCon).toBeLessThan(idxSin);
    });
  });

  it("el desvinculado CON puntaje aparece; el desvinculado sin puntaje, no", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const cobro = await conMercaderista(c, "07", USUARIOS.supervisor, false);
      const seFue = await conMercaderista(c, "08", USUARIOS.supervisor, false);
      await conPuntaje(c, cobro, "2026-07-01", 80, { cerrado: true });

      const filas = await ranking(c);

      expect(filas.some((f) => f.mercaderista_id === cobro)).toBe(true);
      expect(filas.some((f) => f.mercaderista_id === seFue)).toBe(false);
    });
  });
});

describe("evolución contra el periodo anterior", () => {
  it("trae el total y la posición anteriores; sin periodo anterior, NULL y no 0", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const sube = await conMercaderista(c, "09", USUARIOS.supervisor);
      const nuevo = await conMercaderista(c, "10", USUARIOS.supervisor);
      await conPuntaje(c, sube, "2026-06-01", 70);
      await conPuntaje(c, sube, "2026-07-01", 85);
      await conPuntaje(c, nuevo, "2026-07-01", 60);

      const filas = await ranking(c);
      const elQueSube = filas.find((f) => f.mercaderista_id === sube);
      const elNuevo = filas.find((f) => f.mercaderista_id === nuevo);

      expect(Number(elQueSube?.total_anterior)).toBe(70);
      expect(elQueSube?.posicion_anterior).toBe(1);
      expect(elNuevo?.total_anterior).toBeNull();
      expect(elNuevo?.posicion_anterior).toBeNull();
    });
  });

  it("resuelve el periodo anterior para LOS TRES tipos", async () => {
    // La regla del proyecto: una función que ramifica sobre un enum se prueba
    // con todos sus valores. Un anterior mal resuelto para `anual` se nota al
    // cierre del año — con un bono delante.
    const casos = [
      { tipo: "mensual", inicio: "2026-07-01", anterior: "2026-06-01" },
      { tipo: "trimestral", inicio: "2026-07-01", anterior: "2026-04-01" },
      { tipo: "anual", inicio: "2026-01-01", anterior: "2025-01-01" },
    ] as const;

    for (const caso of casos) {
      await comoUsuario(db, USUARIOS.admin, async (c) => {
        const m = await conMercaderista(c, "11", USUARIOS.supervisor);
        await conPuntaje(c, m, caso.anterior, 66, { tipo: caso.tipo });
        await conPuntaje(c, m, caso.inicio, 77, { tipo: caso.tipo });

        const filas = await ranking(c, caso.inicio, caso.tipo);
        const fila = filas.find((f) => f.mercaderista_id === m);
        expect(
          Number(fila?.total_anterior),
          `el periodo anterior de ${caso.tipo} no resolvió`,
        ).toBe(66);
      });
    }
  });

  it("marca cuando el periodo anterior se calculó con OTRA configuración", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // Una config nueva del mismo cliente, publicada después.
      const otraConfig = id("2", "12");
      await c.query("set local role postgres");
      await c.query(
        `insert into public.config_perfect_merchandiser
           (id, tenant_id, peso_puntualidad, peso_asistencia,
            peso_tiempo_efectivo, peso_calidad, peso_herramientas,
            tolerancia_puntualidad_min, minutos_tardanza_cero, vigente_desde)
         values ($1, $2, 40, 30, 0, 20, 10, 10, 50, '2026-07-01')`,
        [otraConfig, TENANTS.maracumango],
      );
      await c.query("set local role authenticated");

      const m = await conMercaderista(c, "12", USUARIOS.supervisor);
      await conPuntaje(c, m, "2026-06-01", 70, { configId: CONFIG_SEED });
      await conPuntaje(c, m, "2026-07-01", 80, { configId: otraConfig });

      const filas = await ranking(c);
      expect(filas.find((f) => f.mercaderista_id === m)?.config_distinta).toBe(
        true,
      );
    });
  });
});

describe("nivel de bono", () => {
  it("muestra el nivel GUARDADO: publicar una escalera nueva no reescribe la historia", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const m = await conMercaderista(c, "13", USUARIOS.supervisor);
      await conPuntaje(c, m, "2026-07-01", 85, {
        nivelId: NIVEL_PLATA,
        cerrado: true,
      });

      // Una escalera nueva, más exigente, publicada DESPUÉS del cierre.
      await c.query("set local role postgres");
      await c.query(
        `insert into public.nivel_bono_merchandiser
           (tenant_id, vigente_desde, nombre, puntaje_min, monto)
         values ($1, '2026-08-01', 'Nada para nadie', 99, 1.00)`,
        [TENANTS.maracumango],
      );
      await c.query("set local role authenticated");

      const filas = await ranking(c);
      const fila = filas.find((f) => f.mercaderista_id === m);
      expect(fila?.nivel_bono).toBe("Plata");
      expect(Number(fila?.nivel_bono_monto)).toBe(250);
    });
  });
});

describe("quién ve el ranking", () => {
  it("el supervisor ve SOLO a su equipo, con las posiciones del cliente entero", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const suyo = await conMercaderista(c, "14", USUARIOS.supervisor);
      const ajeno = await conMercaderista(
        c,
        "15",
        USUARIOS.supervisorSinEquipo,
      );
      // El ajeno puntúa MÁS: su posición (1) tiene que empujar la del suyo (2)
      // aunque el supervisor no lo vea en la lista.
      await conPuntaje(c, ajeno, "2026-07-01", 95);
      await conPuntaje(c, suyo, "2026-07-01", 80);

      await c.query(
        `set local request.jwt.claims = '${JSON.stringify({
          sub: USUARIOS.supervisor,
          role: "authenticated",
          aal: "aal2",
        })}'`,
      );
      const filas = await ranking(c);

      expect(filas.some((f) => f.mercaderista_id === ajeno)).toBe(false);
      expect(filas.find((f) => f.mercaderista_id === suyo)?.posicion).toBe(2);
    });
  });

  it("un supervisor sin equipo obtiene CERO de lo sembrado; el admin, todo", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const m = await conMercaderista(c, "16", USUARIOS.supervisor);
      await conPuntaje(c, m, "2026-07-01", 80);

      await c.query(
        `set local request.jwt.claims = '${JSON.stringify({
          sub: USUARIOS.supervisorSinEquipo,
          role: "authenticated",
          aal: "aal2",
        })}'`,
      );
      const deRosa = await ranking(c);
      expect(deRosa.some((f) => f.mercaderista_id === m)).toBe(false);

      await c.query(
        `set local request.jwt.claims = '${JSON.stringify({
          sub: USUARIOS.admin,
          role: "authenticated",
          aal: "aal2",
        })}'`,
      );
      const deAdmin = await ranking(c);
      expect(deAdmin.some((f) => f.mercaderista_id === m)).toBe(true);
    });
  });

  it("el mercaderista y el cliente-marca mueren en el gate: 42501", async () => {
    for (const usuario of [
      USUARIOS.mercaderistaMaracumango,
      USUARIOS.clienteMaracumango,
    ]) {
      await comoUsuario(db, usuario, async (c) => {
        const codigo = await codigoDeError(
          c,
          `select * from public.ranking_merchandiser(
             '${TENANTS.maracumango}', 'mensual', '2026-07-01')`,
        );
        expect(codigo).toBe("42501");
      });
    }
  });

  it("el mercaderista del OTRO cliente jamás aparece en el ranking del tenant A", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const filas = await ranking(c);
      expect(
        filas.some((f) => f.mercaderista_id === USUARIOS.mercaderistaRival),
      ).toBe(false);
    });
  });
});

describe("la POLÍTICA, no solo la RPC (lectura directa por PostgREST)", () => {
  it("un supervisor sin equipo no lee lo sembrado; el propio supervisor sí", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const m = await conMercaderista(c, "17", USUARIOS.supervisor);
      await conPuntaje(c, m, "2026-07-01", 80);

      await c.query(
        `set local request.jwt.claims = '${JSON.stringify({
          sub: USUARIOS.supervisorSinEquipo,
          role: "authenticated",
          aal: "aal2",
        })}'`,
      );
      const deRosa = await c.query(
        `select 1 from public.puntaje_merchandiser where mercaderista_id = $1`,
        [m],
      );
      expect(deRosa.rowCount).toBe(0);

      await c.query(
        `set local request.jwt.claims = '${JSON.stringify({
          sub: USUARIOS.supervisor,
          role: "authenticated",
          aal: "aal2",
        })}'`,
      );
      const deAna = await c.query(
        `select 1 from public.puntaje_merchandiser where mercaderista_id = $1`,
        [m],
      );
      expect(deAna.rowCount).toBe(1);
    });
  });

  it("el mercaderista sigue leyendo SOLO su propia fila (no regresión de MAR-103)", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const otro = await conMercaderista(c, "18", USUARIOS.supervisor);
      await conPuntaje(c, otro, "2026-07-01", 80);
      await conPuntaje(c, USUARIOS.mercaderistaMaracumango, "2026-07-01", 70);

      await c.query(
        `set local request.jwt.claims = '${JSON.stringify({
          sub: USUARIOS.mercaderistaMaracumango,
          role: "authenticated",
          aal: "aal2",
        })}'`,
      );
      const filas = await c.query<{ mercaderista_id: string }>(
        `select mercaderista_id from public.puntaje_merchandiser
         where periodo_inicio = '2026-07-01'`,
      );

      expect(
        filas.rows.every(
          (f) => f.mercaderista_id === USUARIOS.mercaderistaMaracumango,
        ),
      ).toBe(true);
      expect(filas.rowCount).toBe(1);
    });
  });
});

describe("el recálculo se acota al cliente", () => {
  it("recalcular el cliente A no toca a los mercaderistas del cliente B", async () => {
    // El botón del panel dispara esta RPC. Sin acotar, el supervisor de un
    // cliente SELLARÍA los periodos vencidos de otro — irreversible, y de ahí
    // sale un bono. Es la frontera de esta acción, no un detalle de eficiencia.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await c.query<{ procesados: number }>(
        `select procesados from public.recalcular_puntaje_merchandiser(
           'mensual', '2026-02-01', null, $1)`,
        [TENANTS.maracumango],
      );

      expect(r.rows[0]!.procesados).toBeGreaterThan(0);

      // El del OTRO cliente no recibió cálculo alguno.
      const rival = await c.query(
        `select 1 from public.puntaje_merchandiser
         where mercaderista_id = $1 and periodo_inicio = '2026-02-01'`,
        [USUARIOS.mercaderistaRival],
      );
      expect(rival.rowCount).toBe(0);
    });
  });

  it("sin `p_tenant` sigue recorriendo todos: el operador con service_role no pierde su herramienta", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const acotado = await c.query<{ procesados: number }>(
        `select procesados from public.recalcular_puntaje_merchandiser(
           'mensual', '2026-03-01', null, $1)`,
        [TENANTS.maracumango],
      );
      const todos = await c.query<{ procesados: number }>(
        `select procesados from public.recalcular_puntaje_merchandiser(
           'mensual', '2026-03-01')`,
      );

      expect(todos.rows[0]!.procesados).toBeGreaterThan(
        acotado.rows[0]!.procesados,
      );
    });
  });
});

describe("el detalle: los hechos y la MISMA rampa que el motor", () => {
  it("una llegada 20 min tarde puntúa 88.89 con la config del seed (tolerancia 15, cero 60)", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // Una parada publicada con hora y una llegada 20 min tarde, en julio.
      const rutero = id("3", "19");
      const parada = id("4", "19");
      const visita = id("5", "19");
      await c.query("set local role postgres");
      await c.query(
        `insert into public.rutero (id, tenant_id, mercaderista_id, fecha)
         values ($1, $2, $3, '2026-07-06')`,
        [rutero, TENANTS.maracumango, USUARIOS.mercaderistaMaracumango],
      );
      await c.query(
        `insert into public.rutero_parada
           (id, tenant_id, rutero_id, tienda_id, orden, hora_planificada)
         values ($1, $2, $3, 'a0000002-0000-0000-0000-000000000001', 1, '09:00')`,
        [parada, TENANTS.maracumango, rutero],
      );
      await c.query(
        `update public.rutero set estado = 'publicado' where id = $1`,
        [rutero],
      );
      await c.query(
        `insert into public.visita
           (id, tenant_id, rutero_parada_id, mercaderista_id, tienda_id, check_in_at)
         values ($1, $2, $3, $4, 'a0000002-0000-0000-0000-000000000001',
                 ('2026-07-06 09:20'::timestamp at time zone 'America/Lima'))`,
        [visita, TENANTS.maracumango, parada, USUARIOS.mercaderistaMaracumango],
      );
      await c.query("set local role authenticated");

      const r = await c.query<{
        minutos_desvio: number;
        asistencia: string;
        puntos: string | null;
        tienda_nombre: string;
      }>(
        `select minutos_desvio, asistencia, puntos, tienda_nombre
         from public.paradas_del_periodo_merchandiser($1, 'mensual', '2026-07-01')`,
        [USUARIOS.mercaderistaMaracumango],
      );

      const fila = r.rows.find((x) => x.minutos_desvio === 20);
      expect(fila).toBeDefined();
      expect(fila?.asistencia).toBe("asistio");
      // 100 · (1 − (20−15)/(60−15)) = 88.89 — la misma rampa que promedia el
      // motor, por construcción (app.puntaje_de_parada).
      expect(Number(fila?.puntos)).toBeCloseTo(88.89, 2);
      expect(fila?.tienda_nombre).not.toBeNull();
    });
  });

  it("el detalle de un mercaderista ajeno muere con 42501", async () => {
    await comoUsuario(db, USUARIOS.supervisorSinEquipo, async (c) => {
      const codigo = await codigoDeError(
        c,
        `select * from public.paradas_del_periodo_merchandiser(
           '${USUARIOS.mercaderistaMaracumango}', 'mensual', '2026-07-01')`,
      );
      expect(codigo).toBe("42501");
    });
  });
});
