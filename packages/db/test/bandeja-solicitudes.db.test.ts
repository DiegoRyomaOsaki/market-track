import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// La bandeja de solicitudes de cambio de ruta del supervisor. Lo que se prueba
// aquí es quién ve qué: el filtro por equipo es comodidad de UI, pero el límite
// entre clientes y el que separa al mercaderista de sus compañeros no lo son.

type FilaBandeja = {
  id: string;
  mercaderista_id: string;
  mercaderista_nombre: string;
  tipo: string;
  motivo: string;
  estado: string;
  resuelta_por_nombre: string | null;
  comentario_resolucion: string | null;
};

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

async function bandeja(c: Client, soloMiEquipo = true): Promise<FilaBandeja[]> {
  const r = await c.query<FilaBandeja>(
    `select * from public.bandeja_solicitudes($1)`,
    [soloMiEquipo],
  );
  return r.rows;
}

/** Crea una solicitud como el mercaderista indicado, por el camino real (RLS). */
async function solicitar(
  c: Client,
  mercaderista: string,
  tenant: string,
  motivo: string,
): Promise<string> {
  await c.query("set local role postgres");
  const r = await c.query<{ id: string }>(
    `insert into public.solicitud_cambio_ruta
       (tenant_id, mercaderista_id, tipo, motivo)
     values ($1, $2, 'cambio_dia', $3) returning id`,
    [tenant, mercaderista, motivo],
  );
  await c.query("set local role authenticated");
  return r.rows[0]?.id ?? "";
}

describe("bandeja_solicitudes", () => {
  it("trae el nombre del mercaderista junto al motivo", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await solicitar(
        c,
        USUARIOS.mercaderistaMaracumango,
        TENANTS.maracumango,
        "Tienda cerrada por inventario",
      );
      const filas = await bandeja(c, false);
      const suya = filas.find(
        (f) => f.motivo === "Tienda cerrada por inventario",
      );
      expect(suya?.mercaderista_nombre).toBeTruthy();
      expect(suya?.estado).toBe("nueva");
    });
  });

  it("las pendientes van primero: es una bandeja de trabajo", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const vieja = await solicitar(
        c,
        USUARIOS.mercaderistaMaracumango,
        TENANTS.maracumango,
        "Ya resuelta",
      );
      await c.query("set local role postgres");
      await c.query(
        `update public.solicitud_cambio_ruta set estado = 'resuelta' where id = $1`,
        [vieja],
      );
      await c.query("set local role authenticated");
      await solicitar(
        c,
        USUARIOS.mercaderistaMaracumango,
        TENANTS.maracumango,
        "Todavía pendiente",
      );

      const filas = await bandeja(c, false);
      const posPendiente = filas.findIndex(
        (f) => f.motivo === "Todavía pendiente",
      );
      const posResuelta = filas.findIndex((f) => f.motivo === "Ya resuelta");
      expect(posPendiente).toBeLessThan(posResuelta);
    });
  });

  it("el mercaderista no ve la bandeja de sus compañeros", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await solicitar(
        c,
        USUARIOS.mercaderistaRival,
        TENANTS.rival,
        "De otro cliente",
      );
      const filas = await bandeja(c, false);
      expect(
        filas.every(
          (f) => f.mercaderista_id === USUARIOS.mercaderistaMaracumango,
        ),
      ).toBe(true);
    });
  });

  it("el cliente-marca no ve ninguna: es un asunto interno", async () => {
    // Une con `profile`, que el cliente no puede leer — misma razón que el
    // tablero del día. Y además una solicitud de ruta no es cosa suya.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await solicitar(
        c,
        USUARIOS.mercaderistaMaracumango,
        TENANTS.maracumango,
        "Cualquier motivo",
      );
      expect(await bandeja(c, false)).toEqual([]);
    });
  });

  it("el filtro por equipo no oculta nada al admin", async () => {
    // El admin no tiene reportes directos: si el filtro se le aplicara, su
    // bandeja saldría siempre vacía.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await solicitar(
        c,
        USUARIOS.mercaderistaMaracumango,
        TENANTS.maracumango,
        "Para el admin",
      );
      const filas = await bandeja(c, true);
      expect(filas.some((f) => f.motivo === "Para el admin")).toBe(true);
    });
  });

  it("resolver deja constancia de quién y cuándo", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const id = await solicitar(
        c,
        USUARIOS.mercaderistaMaracumango,
        TENANTS.maracumango,
        "A resolver",
      );
      await c.query(
        `update public.solicitud_cambio_ruta
         set estado = 'resuelta', comentario_resolucion = 'Aprobado, ajusto el rutero',
             resuelta_por = $2, resuelta_at = now()
         where id = $1`,
        [id, USUARIOS.supervisor],
      );

      const filas = await bandeja(c, false);
      const fila = filas.find((f) => f.id === id);
      expect(fila?.estado).toBe("resuelta");
      expect(fila?.comentario_resolucion).toBe("Aprobado, ajusto el rutero");
      expect(fila?.resuelta_por_nombre).toBeTruthy();
    });
  });

  it("el mercaderista no puede resolver la suya", async () => {
    // No tiene política de UPDATE: el update no da error, afecta a 0 filas.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const id = await solicitar(
        c,
        USUARIOS.mercaderistaMaracumango,
        TENANTS.maracumango,
        "Intento de autoaprobación",
      );
      const r = await c.query(
        `update public.solicitud_cambio_ruta set estado = 'resuelta' where id = $1`,
        [id],
      );
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("feed en vivo de solicitudes", () => {
  it("crear una solicitud emite al canal del staff", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await c.query("set local role postgres");
      await c.query("delete from realtime.messages");
      await c.query(
        `insert into public.solicitud_cambio_ruta
           (tenant_id, mercaderista_id, tipo, motivo)
         values ($1, $2, 'no_visita', 'Llegó una emergencia')`,
        [TENANTS.maracumango, USUARIOS.mercaderistaMaracumango],
      );
      const r = await c.query<{ topic: string }>(
        `select topic from realtime.messages order by topic`,
      );
      expect(r.rows.map((x) => x.topic)).toContain(
        "staff:solicitud_cambio_ruta",
      );
    });
  });

  it("el supervisor puede unirse al canal nuevo", async () => {
    const topico = "staff:solicitud_cambio_ruta";
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await c.query("set local role postgres");
      await c.query(
        `insert into realtime.messages (topic, extension, event, private, inserted_at)
         values ($1, 'broadcast', 'marca-del-test', true, now())`,
        [topico],
      );
      await c.query("set local role authenticated");
      await c.query(`set local realtime.topic = '${topico}'`);
      const r = await c.query<{ n: string }>(
        `select count(*)::text as n from realtime.messages
         where topic = $1 and event = 'marca-del-test'`,
        [topico],
      );
      expect(Number(r.rows[0]?.n)).toBe(1);
    });
  });

  it("el cliente NO puede unirse: la solicitud de ruta no es cosa suya", async () => {
    const topico = "staff:solicitud_cambio_ruta";
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await c.query("set local role postgres");
      await c.query(
        `insert into realtime.messages (topic, extension, event, private, inserted_at)
         values ($1, 'broadcast', 'marca-del-test', true, now())`,
        [topico],
      );
      await c.query("set local role authenticated");
      await c.query(`set local realtime.topic = '${topico}'`);
      const r = await c.query<{ n: string }>(
        `select count(*)::text as n from realtime.messages
         where topic = $1 and event = 'marca-del-test'`,
        [topico],
      );
      expect(Number(r.rows[0]?.n)).toBe(0);
    });
  });

  it("el canal de tenant de las solicitudes se queda sin oyentes", async () => {
    // El trigger emite a los dos canales, pero la política del cliente solo
    // enumera `alerta` y `visita`. Es deliberado: si algún día el portal
    // necesitara este feed, habría que ampliarla a conciencia.
    const topico = `tenant:${TENANTS.maracumango}:solicitud_cambio_ruta`;
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await c.query("set local role postgres");
      await c.query(
        `insert into realtime.messages (topic, extension, event, private, inserted_at)
         values ($1, 'broadcast', 'marca-del-test', true, now())`,
        [topico],
      );
      await c.query("set local role authenticated");
      await c.query(`set local realtime.topic = '${topico}'`);
      const r = await c.query<{ n: string }>(
        `select count(*)::text as n from realtime.messages
         where topic = $1 and event = 'marca-del-test'`,
        [topico],
      );
      expect(Number(r.rows[0]?.n)).toBe(0);
    });
  });
});
