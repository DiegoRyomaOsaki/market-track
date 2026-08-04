import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// La revisión de reportes: quién puede decidir, quién solo lee, y qué devuelven
// la cola y el detalle. Todo derivado vive en la base, así que se prueba aquí.

const VISITA_MRC = "a0000010-0000-0000-0000-000000000001";
const VISITA_RIVAL = "b0000010-0000-0000-0000-000000000002";

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

/**
 * Cierra la visita del seed: nace `en_curso` y sin check-out, y la cola solo mira
 * las cerradas.
 */
async function conVisitaCerrada(c: Client, visita = VISITA_MRC): Promise<void> {
  await c.query("set local role postgres");
  await c.query(
    `update public.visita
     set estado = 'completada', check_out_at = check_in_at + interval '47 min'
     where id = $1`,
    [visita],
  );
  await c.query("set local role authenticated");
}

/** Deja una decisión puesta, saltándose el gate, para probar la LECTURA. */
async function conRevision(
  c: Client,
  decision: "aprobada" | "rechazada",
  motivo: string | null,
  visita = VISITA_MRC,
  tenant: string = TENANTS.maracumango,
): Promise<void> {
  await c.query("set local role postgres");
  await c.query(
    `insert into public.revision_visita
       (tenant_id, visita_id, decision, motivo, revisor_id)
     values ($1, $2, $3, $4, $5)
     on conflict (visita_id) do update set decision = excluded.decision,
       motivo = excluded.motivo`,
    [tenant, visita, decision, motivo, USUARIOS.supervisor],
  );
  await c.query("set local role authenticated");
}

describe("revisar_visita — decide el staff", () => {
  it("el supervisor aprueba y queda firmado por él", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await conVisitaCerrada(c);
      await c.query(`select public.revisar_visita($1, 'aprobada', '')`, [
        VISITA_MRC,
      ]);

      const r = await c.query<{
        decision: string;
        revisor_id: string;
        motivo: string | null;
      }>(
        `select decision, revisor_id, motivo from public.revision_visita where visita_id = $1`,
        [VISITA_MRC],
      );
      expect(r.rows[0]).toMatchObject({
        decision: "aprobada",
        revisor_id: USUARIOS.supervisor,
        // El motivo vacío se normaliza a null: aprobar no lo exige.
        motivo: null,
      });
    });
  });

  it("rechazar SIN motivo lo para la base, no solo la UI", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await conVisitaCerrada(c);
      await expect(
        c.query(`select public.revisar_visita($1, 'rechazada', '   ')`, [
          VISITA_MRC,
        ]),
      ).rejects.toMatchObject({
        // Se fijan código y constraint: sin esto, el día que falle por otra cosa
        // el test seguiría verde sin proteger nada.
        code: "23514",
        constraint: "revision_motivo_si_rechaza",
      });
    });
  });

  it("re-decidir pisa la decisión vigente en vez de acumular filas", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await conVisitaCerrada(c);
      await c.query(`select public.revisar_visita($1, 'aprobada', '')`, [
        VISITA_MRC,
      ]);
      await c.query(
        `select public.revisar_visita($1, 'rechazada', 'Falta la foto Después')`,
        [VISITA_MRC],
      );

      const r = await c.query<{ n: string; decision: string }>(
        `select count(*)::text as n, max(decision::text) as decision
         from public.revision_visita where visita_id = $1`,
        [VISITA_MRC],
      );
      expect(r.rows[0]).toMatchObject({ n: "1", decision: "rechazada" });
    });
  });

  it("una visita sin cerrar todavía no es un reporte que revisar", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await expect(
        c.query(`select public.revisar_visita($1, 'aprobada', '')`, [
          VISITA_MRC,
        ]),
      ).rejects.toThrow(/no existe|no está cerrada|no es tuya/);
    });
  });

  it("el mercaderista NO puede aprobarse su propio reporte", async () => {
    // Es el criterio 3 del ticket. No tiene política de INSERT: no es que se le
    // impida por procedimiento, es que la fila vive donde él no escribe.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await conVisitaCerrada(c);
      await expect(
        c.query(`select public.revisar_visita($1, 'aprobada', '')`, [
          VISITA_MRC,
        ]),
      ).rejects.toThrow();
    });
  });

  it("el mercaderista tampoco puede cambiar el motivo de su rechazo", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await conVisitaCerrada(c);
      await conRevision(c, "rechazada", "Falta la foto Después");

      const r = await c.query(
        `update public.revision_visita set motivo = 'todo bien' where visita_id = $1`,
        [VISITA_MRC],
      );
      // Sin política de UPDATE no hay error: simplemente no afecta a ninguna fila.
      expect(r.rowCount).toBe(0);
    });
  });

  it("un supervisor no puede firmar la decisión con el nombre de otro", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await conVisitaCerrada(c);
      await expect(
        c.query(
          `insert into public.revision_visita
             (tenant_id, visita_id, decision, revisor_id)
           values ($1, $2, 'aprobada', $3)`,
          [TENANTS.maracumango, VISITA_MRC, USUARIOS.admin],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });
});

describe("quién LEE la revisión", () => {
  it("el mercaderista lee la de su visita: es lo que su app le enseña", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await conVisitaCerrada(c);
      await conRevision(c, "rechazada", "Falta la foto Después");

      const r = await c.query<{ motivo: string }>(
        `select motivo from public.revision_visita where visita_id = $1`,
        [VISITA_MRC],
      );
      expect(r.rows[0]?.motivo).toBe("Falta la foto Después");
    });
  });

  it("el mercaderista no ve la revisión de la visita de otro", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await conVisitaCerrada(c, VISITA_RIVAL);
      await conRevision(c, "aprobada", null, VISITA_RIVAL, TENANTS.rival);

      const r = await c.query<{ visita_id: string }>(
        `select visita_id from public.revision_visita`,
      );
      expect(r.rows.filter((x) => x.visita_id === VISITA_RIVAL)).toEqual([]);
    });
  });

  it("el cliente-marca NO ve ninguna revisión, y es deliberado", async () => {
    // Es control de calidad interno de la outsourcing sobre su propio empleado.
    // El brand manager es una parte externa: no se le escribió política, y este
    // test está para que nadie se la añada creyendo que faltaba.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await conVisitaCerrada(c);
      await conRevision(c, "rechazada", "Falta la foto Después");

      const r = await c.query(`select * from public.revision_visita`);
      expect(r.rows).toEqual([]);
    });
  });
});

describe("cola_revision", () => {
  it("una visita cerrada sin revisar sale como pendiente", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await conVisitaCerrada(c);
      const r = await c.query<{ visita_id: string; decision: string | null }>(
        `select visita_id, decision from public.cola_revision('2020-01-01','2030-01-01')`,
      );
      const fila = r.rows.find((x) => x.visita_id === VISITA_MRC);
      expect(fila?.decision).toBeNull();
    });
  });

  it("una visita SIN cerrar no entra en la cola", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const r = await c.query<{ visita_id: string }>(
        `select visita_id from public.cola_revision('2020-01-01','2030-01-01')`,
      );
      expect(r.rows.find((x) => x.visita_id === VISITA_MRC)).toBeUndefined();
    });
  });

  it("trae los conteos derivados de la visita", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await conVisitaCerrada(c);
      const r = await c.query<{
        marcas: string;
        contingencias: string;
        quiebres: string;
        duracion_min: number;
      }>(
        `select marcas, contingencias, quiebres, duracion_min
         from public.cola_revision('2020-01-01','2030-01-01') where visita_id = $1`,
        [VISITA_MRC],
      );
      expect(Number(r.rows[0]?.marcas)).toBeGreaterThan(0);
      expect(Number(r.rows[0]?.contingencias)).toBeGreaterThan(0);
      expect(Number(r.rows[0]?.quiebres)).toBeGreaterThan(0);
      expect(r.rows[0]?.duracion_min).toBe(47);
    });
  });

  it("cuenta como pendiente la evidencia que sigue en el teléfono", async () => {
    // Sin `subida_at` no hay objeto que firmar en R2: aprobar sería aprobar a
    // ciegas, y la cola tiene que decirlo.
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await conVisitaCerrada(c);
      const r = await c.query<{ fotos: string; fotos_pendientes: string }>(
        `select fotos, fotos_pendientes
         from public.cola_revision('2020-01-01','2030-01-01') where visita_id = $1`,
        [VISITA_MRC],
      );
      expect(Number(r.rows[0]?.fotos)).toBeGreaterThan(0);
      expect(Number(r.rows[0]?.fotos_pendientes)).toBe(
        Number(r.rows[0]?.fotos),
      );

      await c.query("set local role postgres");
      await c.query(
        `update public.foto set subida_at = now() where visita_id = $1`,
        [VISITA_MRC],
      );
      await c.query("set local role authenticated");

      const r2 = await c.query<{ fotos_pendientes: string }>(
        `select fotos_pendientes
         from public.cola_revision('2020-01-01','2030-01-01') where visita_id = $1`,
        [VISITA_MRC],
      );
      expect(Number(r2.rows[0]?.fotos_pendientes)).toBe(0);
    });
  });

  it("la ventana es el día de LIMA, no el de UTC", async () => {
    // Una visita cerrada a las 20:00 de Lima ya es del día siguiente en UTC. Si la
    // ventana se resolviera en UTC, no saldría al pedir su propio día.
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await c.query("set local role postgres");
      await c.query(
        `update public.visita
         set estado = 'completada',
             check_in_at  = timestamptz '2026-03-10 19:00:00-05',
             check_out_at = timestamptz '2026-03-10 20:00:00-05'
         where id = $1`,
        [VISITA_MRC],
      );
      await c.query("set local role authenticated");

      const suDia = await c.query(
        `select visita_id from public.cola_revision('2026-03-10','2026-03-10')`,
      );
      const elSiguiente = await c.query(
        `select visita_id from public.cola_revision('2026-03-11','2026-03-11')`,
      );

      expect(suDia.rows).toHaveLength(1);
      expect(elSiguiente.rows).toEqual([]);
    });
  });

  it("las pendientes van primero, y entre ellas la más vieja antes", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await c.query("set local role postgres");
      // Dos visitas cerradas: la del rival es más reciente y ya está revisada.
      await c.query(
        `update public.visita set estado = 'completada',
           check_out_at = timestamptz '2026-03-01 12:00:00-05' where id = $1`,
        [VISITA_MRC],
      );
      await c.query(
        `update public.visita set estado = 'completada',
           check_out_at = timestamptz '2026-03-02 12:00:00-05' where id = $1`,
        [VISITA_RIVAL],
      );
      await c.query("set local role authenticated");
      await conRevision(c, "aprobada", null, VISITA_MRC, TENANTS.maracumango);

      const r = await c.query<{ visita_id: string; decision: string | null }>(
        `select visita_id, decision from public.cola_revision('2026-03-01','2026-03-02')`,
      );
      // La pendiente (rival) sale antes que la ya revisada, aunque sea posterior.
      expect(r.rows[0]?.visita_id).toBe(VISITA_RIVAL);
      expect(r.rows[0]?.decision).toBeNull();
    });
  });

  it("el cliente-marca no recibe ni una fila de la cola", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await conVisitaCerrada(c);
      const r = await c.query(
        `select * from public.cola_revision('2020-01-01','2030-01-01')`,
      );
      expect(r.rows).toEqual([]);
    });
  });
});

describe("detalle_visita", () => {
  it("arma el reporte completo con sus marcas, SKUs y contingencias", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await conVisitaCerrada(c);
      const r = await c.query<{ d: Record<string, unknown> }>(
        `select public.detalle_visita($1) as d`,
        [VISITA_MRC],
      );
      const d = r.rows[0]?.d as {
        visita: { tienda_nombre: string; duracion_min: number };
        levantamientos: { marca_nombre: string; skus: unknown[] }[];
        contingencias: unknown[];
        fotos: unknown[];
        revision: unknown;
      };

      expect(d.visita.tienda_nombre).toBeTruthy();
      expect(d.visita.duracion_min).toBe(47);
      expect(d.levantamientos.length).toBeGreaterThan(0);
      expect(d.levantamientos[0]?.marca_nombre).toBeTruthy();
      expect(d.levantamientos[0]?.skus.length).toBeGreaterThan(0);
      expect(d.contingencias.length).toBeGreaterThan(0);
      expect(d.fotos.length).toBeGreaterThan(0);
      expect(d.revision).toBeNull();
    });
  });

  it("el quiebre viene de la columna generada, no se recalcula", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const r = await c.query<{ d: Record<string, unknown> }>(
        `select public.detalle_visita($1) as d`,
        [VISITA_MRC],
      );
      const d = r.rows[0]?.d as {
        levantamientos: { skus: { quiebre: boolean; stock_piso: number }[] }[];
      };
      const conQuiebre = d.levantamientos
        .flatMap((l) => l.skus)
        .filter((s) => s.quiebre);
      expect(conQuiebre.length).toBeGreaterThan(0);
      // La columna generada exige piso 0: si alguien la recalculara mal en SQL,
      // esto se rompería.
      expect(conQuiebre.every((s) => s.stock_piso === 0)).toBe(true);
    });
  });

  it("la visita de otro cliente devuelve null, no un objeto vacío", async () => {
    // Null es indistinguible de "no existe": no se puede sondear qué visitas tiene
    // otro cliente.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const r = await c.query<{ d: unknown }>(
        `select public.detalle_visita($1) as d`,
        [VISITA_RIVAL],
      );
      expect(r.rows[0]?.d).toBeNull();
    });
  });

  it("una visita inexistente responde igual que una ajena", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const r = await c.query<{ d: unknown }>(
        `select public.detalle_visita($1) as d`,
        ["aaaa0000-0000-0000-0000-00000000ffff"],
      );
      expect(r.rows[0]?.d).toBeNull();
    });
  });

  it("incluye la revisión una vez decidida", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await conVisitaCerrada(c);
      await conRevision(c, "rechazada", "Falta la foto Después");

      const r = await c.query<{ d: Record<string, unknown> }>(
        `select public.detalle_visita($1) as d`,
        [VISITA_MRC],
      );
      const d = r.rows[0]?.d as {
        revision: { decision: string; motivo: string; revisor_nombre: string };
      };
      expect(d.revision).toMatchObject({
        decision: "rechazada",
        motivo: "Falta la foto Después",
        revisor_nombre: "Ana Torres",
      });
    });
  });
});
