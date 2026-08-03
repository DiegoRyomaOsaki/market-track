import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// El formato del topic se escribe A MANO aquí, no se importa de
// `packages/shared`: `shared` ya depende de `db` para los tipos generados, e
// importarlo de vuelta cerraría un ciclo entre paquetes. Estas dos cadenas y las
// de `packages/shared/src/realtime/topicos.test.ts` son la misma especificación
// dicha dos veces; si alguien cambia el formato en un solo lado, uno de los dos
// tests se cae.
const topicoTenant = (tenantId: string, feed: string) =>
  `tenant:${tenantId}:${feed}`;
const topicoStaff = (feed: string) => `staff:${feed}`;

// Feeds en vivo por Broadcast. Aquí se prueba la promesa que da el ticket: una
// alerta nueva llega al canal correcto y NO llega al del cliente rival.
//
// Realtime autoriza consultando `realtime.messages` con el topic del cliente en
// el GUC `realtime.topic` y revirtiendo. Eso es exactamente lo que se reproduce
// abajo: rol `authenticated`, claims del usuario, `set local realtime.topic`, y
// se cuenta lo que la RLS deja ver. Sin websocket, misma decisión de acceso.

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

/**
 * Siembra un mensaje de broadcast en cada topic que nos interesa.
 *
 * `realtime.messages` está particionada por `inserted_at`; el seed va a la
 * partición de hoy, que es la que Realtime tiene creada. Todo vive dentro de la
 * transacción con rollback de `comoUsuario`, así que no queda nada.
 */
async function sembrarMensajes(c: Client, topicos: string[]) {
  for (const topico of topicos) {
    await c.query(
      `insert into realtime.messages (topic, extension, event, private, inserted_at)
       values ($1, 'broadcast', 'INSERT', true, now())`,
      [topico],
    );
  }
}

/** Cuántos mensajes ve este usuario AL UNIRSE a este topic. */
async function mensajesVisiblesEn(c: Client, topico: string): Promise<number> {
  await c.query(`set local realtime.topic = '${topico}'`);
  const r = await c.query<{ n: string }>(
    `select count(*)::text as n from realtime.messages where topic = $1`,
    [topico],
  );
  return Number(r.rows[0]?.n ?? "0");
}

describe("topics de los feeds en vivo", () => {
  it("el formato de TypeScript coincide con el de la base", async () => {
    const r = await db.query<{ tenant: string; staff: string }>(
      `select app.topico_tenant($1, 'alerta') as tenant,
              app.topico_staff('alerta') as staff`,
      [TENANTS.maracumango],
    );
    expect(r.rows[0]?.tenant).toBe(topicoTenant(TENANTS.maracumango, "alerta"));
    expect(r.rows[0]?.staff).toBe(topicoStaff("alerta"));
  });
});

describe("autorización de los canales privados", () => {
  it("el cliente recibe en el canal de su tenant", async () => {
    const topico = topicoTenant(TENANTS.maracumango, "alerta");
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await c.query("set local role postgres");
      await sembrarMensajes(c, [topico]);
      await c.query("set local role authenticated");
      expect(await mensajesVisiblesEn(c, topico)).toBe(1);
    });
  });

  it("el cliente NO recibe en el canal de otro tenant", async () => {
    const ajeno = topicoTenant(TENANTS.rival, "alerta");
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await c.query("set local role postgres");
      await sembrarMensajes(c, [ajeno]);
      await c.query("set local role authenticated");
      expect(await mensajesVisiblesEn(c, ajeno)).toBe(0);
    });
  });

  it("el cliente NO recibe en el canal del staff", async () => {
    const topico = topicoStaff("alerta");
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await c.query("set local role postgres");
      await sembrarMensajes(c, [topico]);
      await c.query("set local role authenticated");
      expect(await mensajesVisiblesEn(c, topico)).toBe(0);
    });
  });

  it("el supervisor recibe en el canal del staff", async () => {
    const topico = topicoStaff("visita");
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await c.query("set local role postgres");
      await sembrarMensajes(c, [topico]);
      await c.query("set local role authenticated");
      expect(await mensajesVisiblesEn(c, topico)).toBe(1);
    });
  });

  it("el mercaderista no recibe en ningún canal: la app de campo es offline", async () => {
    const topicos = [
      topicoTenant(TENANTS.maracumango, "alerta"),
      topicoStaff("alerta"),
    ];
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await c.query("set local role postgres");
      await sembrarMensajes(c, topicos);
      await c.query("set local role authenticated");
      for (const t of topicos) {
        expect(await mensajesVisiblesEn(c, t)).toBe(0);
      }
    });
  });

  it("una sesión sin segundo factor no entra a ningún canal", async () => {
    const topico = topicoTenant(TENANTS.maracumango, "alerta");
    await comoUsuario(
      db,
      USUARIOS.clienteMaracumango,
      async (c) => {
        await c.query("set local role postgres");
        await sembrarMensajes(c, [topico]);
        await c.query("set local role authenticated");
        expect(await mensajesVisiblesEn(c, topico)).toBe(0);
      },
      { aal: "aal1" },
    );
  });

  it("el cliente de un tenant dado de baja pierde el canal", async () => {
    const topico = topicoTenant(TENANTS.maracumango, "alerta");
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await c.query("set local role postgres");
      await sembrarMensajes(c, [topico]);
      await c.query("update public.tenant set activo = false where id = $1", [
        TENANTS.maracumango,
      ]);
      await c.query("set local role authenticated");
      expect(await mensajesVisiblesEn(c, topico)).toBe(0);
    });
  });

  it("authenticated no puede emitir: no hay política de insert", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await expect(
        sembrarMensajes(c, [topicoStaff("alerta")]),
      ).rejects.toThrow();
    });
  });
});

describe("emisión desde los triggers", () => {
  it("insertar una alerta emite al canal del tenant y al del staff", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await c.query("set local role postgres");
      await c.query(
        `insert into public.alerta (tenant_id, tipo, severidad)
         values ($1, 'quiebre', 'alta')`,
        [TENANTS.maracumango],
      );
      const r = await c.query<{ topic: string }>(
        `select topic from realtime.messages order by topic`,
      );
      const topicos = r.rows.map((x) => x.topic);
      expect(topicos).toContain(topicoTenant(TENANTS.maracumango, "alerta"));
      expect(topicos).toContain(topicoStaff("alerta"));
    });
  });
});
