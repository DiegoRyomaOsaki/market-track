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

// Del seed, para montar una visita real y probar el trigger de `visita`.
const PARADA = "a0000009-0000-0000-0000-000000000001";
const TIENDA = "a0000002-0000-0000-0000-000000000001";

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

// El seed ya disparó los triggers, así que `realtime.messages` llega con
// mensajes reales dentro. Cada test marca los suyos con un `event` propio y solo
// cuenta esos: así el conteo no depende de cuántas alertas traiga el seed.
const MARCA_DEL_TEST = "marca-del-test";

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
       values ($1, 'broadcast', $2, true, now())`,
      [topico, MARCA_DEL_TEST],
    );
  }
}

/**
 * Vacía la tabla antes de probar un trigger. El seed ya dejó mensajes de sus
 * propias alertas: sin esto, un test de emisión pasaría aunque el trigger no
 * hiciera nada. El rollback de `comoUsuario` la devuelve a su sitio.
 */
async function vaciarMensajes(c: Client) {
  await c.query("delete from realtime.messages");
}

/** Los topics emitidos, uno por mensaje: sin `distinct`, para ver duplicados. */
async function topicosEmitidos(c: Client): Promise<string[]> {
  const r = await c.query<{ topic: string }>(
    `select topic from realtime.messages order by topic`,
  );
  return r.rows.map((x) => x.topic);
}

/**
 * Cuántos de los mensajes sembrados por este test ve el usuario AL UNIRSE al
 * topic. Filtra por el marcador, pero quien decide es la RLS sobre el topic:
 * si la política no deja entrar al canal, devuelve 0 aunque el mensaje exista.
 */
async function mensajesVisiblesEn(c: Client, topico: string): Promise<number> {
  await c.query(`set local realtime.topic = '${topico}'`);
  const r = await c.query<{ n: string }>(
    `select count(*)::text as n from realtime.messages
     where topic = $1 and event = $2`,
    [topico, MARCA_DEL_TEST],
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

  it("el staff NO entra por el canal de un tenant: tiene el suyo", async () => {
    const topico = topicoTenant(TENANTS.maracumango, "alerta");
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await c.query("set local role postgres");
      await sembrarMensajes(c, [topico]);
      await c.query("set local role authenticated");
      expect(await mensajesVisiblesEn(c, topico)).toBe(0);
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
      // El código importa: `authenticated` SÍ tiene el GRANT de insert que trae
      // Supabase, así que lo que rechaza es la RLS (42501 por política, no por
      // permiso de tabla). Sin fijarlo, un fallo cualquiera daría este test por
      // bueno. "El GRANT es la puerta; la RLS es el portero".
      await expect(
        sembrarMensajes(c, [topicoStaff("alerta")]),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("realtime.messages tiene la RLS encendida: sin ella no hay portero", async () => {
    const r = await db.query<{ activa: boolean }>(
      `select c.relrowsecurity as activa
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'realtime' and c.relname = 'messages'`,
    );
    expect(r.rows[0]?.activa).toBe(true);
  });
});

describe("emisión desde los triggers", () => {
  it("insertar una alerta emite al canal del tenant y al del staff", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await c.query("set local role postgres");
      await vaciarMensajes(c);
      await c.query(
        `insert into public.alerta (tenant_id, tipo, severidad)
         values ($1, 'quiebre', 'alta')`,
        [TENANTS.maracumango],
      );
      // Exactamente dos, sin `distinct`: si el trigger emitiera dos veces al
      // mismo canal, `distinct` lo escondería y el supervisor vería duplicados.
      const emitidos = await topicosEmitidos(c);
      expect(emitidos).toEqual([
        topicoStaff("alerta"),
        topicoTenant(TENANTS.maracumango, "alerta"),
      ]);
    });
  });

  it("el mensaje lleva la fila y la operación, no solo el topic", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await c.query("set local role postgres");
      await vaciarMensajes(c);
      await c.query(
        `insert into public.alerta (tenant_id, tipo, severidad)
         values ($1, 'quiebre', 'alta')`,
        [TENANTS.maracumango],
      );
      const r = await c.query<{
        event: string;
        operacion: string;
        tipo: string;
      }>(
        `select event, payload->>'operation' as operacion,
                payload->'record'->>'tipo' as tipo
         from realtime.messages limit 1`,
      );
      expect(r.rows[0]).toMatchObject({
        event: "INSERT",
        operacion: "INSERT",
        tipo: "quiebre",
      });
    });
  });

  it("si el canal falla, la escritura de campo sobrevive", async () => {
    // Se rompe la construcción del topic, que es lo que `realtime.send` NO cubre:
    // send se traga los fallos de su propio insert, pero cualquier otra cosa la
    // re-lanza `broadcast_changes` y subiría hasta el trigger, abortando el
    // check-in del mercaderista. El dato de campo es el producto; el tile del
    // supervisor, no.
    //
    // Sin el bloque de excepción del trigger este test falla — comprobado
    // mutando la función. El DDL revierte con el rollback de comoUsuario.
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await c.query("set local role postgres");
      await c.query(
        `create or replace function app.topico_tenant(tenant uuid, feed text)
         returns text language plpgsql immutable set search_path = '' as $fn$
         begin raise exception 'fallo simulado del canal'; end $fn$;`,
      );
      const r = await c.query<{ id: string }>(
        `insert into public.alerta (tenant_id, tipo, severidad)
         values ($1, 'quiebre', 'alta') returning id`,
        [TENANTS.maracumango],
      );
      expect(r.rows[0]?.id).toBeTruthy();
    });
  });

  it("el check-out emite: el trigger cubre UPDATE, no solo INSERT", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await c.query("set local role postgres");
      const visita = await c.query<{ id: string }>(
        `insert into public.visita
           (tenant_id, rutero_parada_id, mercaderista_id, tienda_id)
         values ($1, $2, $3, $4) returning id`,
        [TENANTS.maracumango, PARADA, USUARIOS.mercaderistaMaracumango, TIENDA],
      );
      // Vaciar DESPUÉS del check-in: lo que se mide es lo que emite el UPDATE.
      await vaciarMensajes(c);
      await c.query(
        `update public.visita set check_out_at = now(), estado = 'completada'
         where id = $1`,
        [visita.rows[0]?.id],
      );
      expect(await topicosEmitidos(c)).toEqual([
        topicoStaff("visita"),
        topicoTenant(TENANTS.maracumango, "visita"),
      ]);
      const r = await c.query<{ operacion: string }>(
        `select payload->>'operation' as operacion from realtime.messages limit 1`,
      );
      expect(r.rows[0]?.operacion).toBe("UPDATE");
    });
  });
});
