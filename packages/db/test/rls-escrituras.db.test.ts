import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// La RLS de LECTURA la cubre rls.db.test.ts. Este archivo cubre la ESCRITURA —el
// WITH CHECK de cada política y los grants por columna—, que es la superficie por
// la que sube apps/mobile: PowerSync escribe por PostgREST, y su única defensa es
// esto. Sin estos tests, quitar un `tenant_id = app.tenant_actual()` de una
// política de escritura pasaría en verde.
//
// Cada test corre dentro de la transacción con rollback de comoUsuario(): las
// escrituras de prueba no ensucian el seed.

const IDS = {
  ruteroParadaMrc: "a0000009-0000-0000-0000-000000000001",
  tiendaMrc: "a0000002-0000-0000-0000-000000000001",
  ruteroParadaRival: "b0000009-0000-0000-0000-000000000002",
  tiendaRival: "b0000002-0000-0000-0000-000000000002",
  visitaRival: "b0000010-0000-0000-0000-000000000002",
  alertaMrc: "a0000016-0000-0000-0000-000000000001",
  nuevaVisita: "e0000010-0000-0000-0000-000000000099",
  nuevoPase: "e0000020-0000-0000-0000-000000000099",
  nuevaSolicitud: "e0000030-0000-0000-0000-000000000099",
  nuevoFormulario: "e0000040-0000-0000-0000-000000000099",
  nuevaVersionForm: "e0000041-0000-0000-0000-000000000099",
} as const;

// Los tests de "no puede escribir en el tenant ajeno" y "revocación en la
// escritura" usan filas cuyas FK COMPUESTAS (tienda_id + tenant_id,
// rutero_parada_id + tenant_id) están SATISFECHAS a propósito: así lo único que
// puede rechazar la escritura es el WITH CHECK de la política. Si se apoyaran en
// una FK rota, pasarían aunque se quitara la política — un falso verde. (Se
// verificó revirtiendo la política: sin este cuidado, el test no se ponía rojo.)

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

/** Afirma que `fn` es rechazada por la base (RLS, CHECK o grant). */
async function esRechazado(fn: () => Promise<unknown>): Promise<void> {
  await expect(fn()).rejects.toThrow();
}

describe("visita — el camino de subida del móvil", () => {
  it("el mercaderista inserta SU visita sin pasar tenant_id: el default lo pone", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await c.query(
        `insert into public.visita (id, rutero_parada_id, mercaderista_id, tienda_id, estado)
         values ($1, $2, $3, $4, 'en_curso')`,
        [
          IDS.nuevaVisita,
          IDS.ruteroParadaMrc,
          USUARIOS.mercaderistaMaracumango,
          IDS.tiendaMrc,
        ],
      );
      const r = await c.query<{ tenant_id: string }>(
        "select tenant_id from public.visita where id = $1",
        [IDS.nuevaVisita],
      );
      // El default app.tenant_actual() resolvió al tenant del que escribe.
      expect(r.rows[0]?.tenant_id).toBe(TENANTS.maracumango);
    });
  });

  it("el mercaderista NO puede insertar una visita en el tenant ajeno", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      // Fila 100% coherente con el rival (parada y tienda del rival): las FK
      // compuestas pasan. Lo único que puede bloquear es el WITH CHECK, que exige
      // tenant_id = tenant_actual() (= Maracumango). tenant_id = rival lo rompe.
      await esRechazado(() =>
        c.query(
          `insert into public.visita (id, tenant_id, rutero_parada_id, mercaderista_id, tienda_id, estado)
           values ($1, $2, $3, $4, $5, 'en_curso')`,
          [
            IDS.nuevaVisita,
            TENANTS.rival,
            IDS.ruteroParadaRival,
            USUARIOS.mercaderistaMaracumango,
            IDS.tiendaRival,
          ],
        ),
      );
    });
  });

  it("el DESVINCULADO no puede insertar ni en su propio tenant: la revocación llega a la escritura", async () => {
    await comoUsuario(db, USUARIOS.desvinculado, async (c) => {
      // Fila coherente con Maracumango (su tenant): las FK pasan y tenant_id NO es
      // NULL. Lo único que bloquea es el WITH CHECK: perfil_efectivo() devuelve 0
      // filas para el desvinculado → tenant_actual() es NULL → tenant_id =
      // Maracumango ≠ NULL → falla cerrado. Es la revocación en el camino de
      // escritura, que las FK NO cubren.
      await esRechazado(() =>
        c.query(
          `insert into public.visita (id, tenant_id, rutero_parada_id, mercaderista_id, tienda_id, estado)
           values ($1, $2, $3, $4, $5, 'en_curso')`,
          [
            IDS.nuevaVisita,
            TENANTS.maracumango,
            IDS.ruteroParadaMrc,
            USUARIOS.desvinculado,
            IDS.tiendaMrc,
          ],
        ),
      );
    });
  });

  it("el mercaderista no puede actualizar la visita de otro cliente (0 filas, no error)", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const r = await c.query(
        "update public.visita set bitacora = 'intruso' where id = $1",
        [IDS.visitaRival],
      );
      // El USING no la ve: no es un error, es una fila que no existe para él.
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("profile — nadie escala su propio acceso", () => {
  it("el mercaderista no puede cambiarse el rol a admin", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const r = await c.query(
        "update public.profile set rol = 'admin' where id = $1",
        [USUARIOS.mercaderistaMaracumango],
      );
      // Solo profile_admin_escribe puede escribir profile: 0 filas para el resto.
      expect(r.rowCount).toBe(0);
    });
  });

  it("el mercaderista no puede reasignarse a otro tenant", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const r = await c.query(
        "update public.profile set tenant_id = $1 where id = $2",
        [TENANTS.rival, USUARIOS.mercaderistaMaracumango],
      );
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("alerta — el usuario solo cambia el estado", () => {
  it("el mercaderista puede marcar el estado de una alerta de su tenant", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const r = await c.query(
        "update public.alerta set estado = 'vista' where id = $1",
        [IDS.alertaMrc],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("el mercaderista NO puede reescribir la evidencia de la alerta (grant por columna)", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      // El grant es update(estado): tocar `tipo` muere con permission denied,
      // antes incluso de la RLS.
      await esRechazado(() =>
        c.query(
          "update public.alerta set tipo = 'contingencia' where id = $1",
          [IDS.alertaMrc],
        ),
      );
    });
  });
});

describe("pase de acceso temporal — el camino más sensible del auth", () => {
  it("el supervisor no puede atribuir el pase a otro (generado_por ≠ él)", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await esRechazado(() =>
        c.query(
          `insert into public.pase_acceso_temporal (id, profile_id, codigo_hash, motivo, generado_por)
           values ($1, $2, 'hash', 'olvidó el teléfono', $3)`,
          [
            IDS.nuevoPase,
            USUARIOS.mercaderistaMaracumango,
            USUARIOS.admin, // <- se lo atribuye al admin: destruiría la auditoría
          ],
        ),
      );
    });
  });

  it("el supervisor sí emite un pase a los suyos, atribuido a él", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const r = await c.query(
        `insert into public.pase_acceso_temporal (id, profile_id, codigo_hash, motivo, generado_por)
         values ($1, $2, 'hash', 'olvidó el teléfono', $3)`,
        [IDS.nuevoPase, USUARIOS.mercaderistaMaracumango, USUARIOS.supervisor],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("nadie puede emitir un pase que dure más de 15 minutos", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await esRechazado(() =>
        c.query(
          `insert into public.pase_acceso_temporal (id, profile_id, codigo_hash, motivo, generado_por, expira_at)
           values ($1, $2, 'hash', 'motivo', $3, now() + interval '1 hour')`,
          [
            IDS.nuevoPase,
            USUARIOS.mercaderistaMaracumango,
            USUARIOS.supervisor,
          ],
        ),
      );
    });
  });
});

describe("solicitud_cambio_ruta — el mercaderista pide, el staff resuelve", () => {
  const insertar = (
    id: string,
    tenantId: string,
    mercaderistaId: string,
  ): [string, unknown[]] => [
    `insert into public.solicitud_cambio_ruta (id, tenant_id, mercaderista_id, tipo, motivo)
     values ($1, $2, $3, 'no_visita', 'La tienda está cerrada por inventario')`,
    [id, tenantId, mercaderistaId],
  ];

  it("el mercaderista pide SU cambio de ruta", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const r = await c.query(
        ...insertar(
          IDS.nuevaSolicitud,
          TENANTS.maracumango,
          USUARIOS.mercaderistaMaracumango,
        ),
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("no puede pedir a nombre de otro mercaderista", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      // tenant propio, pero mercaderista_id = otro → el WITH CHECK
      // (mercaderista_id = auth.uid()) lo rechaza.
      await esRechazado(() =>
        c.query(
          ...insertar(
            IDS.nuevaSolicitud,
            TENANTS.maracumango,
            USUARIOS.mercaderistaRival,
          ),
        ),
      );
    });
  });

  it("no puede pedir en el tenant ajeno", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await esRechazado(() =>
        c.query(
          ...insertar(
            IDS.nuevaSolicitud,
            TENANTS.rival,
            USUARIOS.mercaderistaMaracumango,
          ),
        ),
      );
    });
  });

  it("el desvinculado no puede pedir: la revocación llega a la escritura", async () => {
    await comoUsuario(db, USUARIOS.desvinculado, async (c) => {
      await esRechazado(() =>
        c.query(
          ...insertar(
            IDS.nuevaSolicitud,
            TENANTS.maracumango,
            USUARIOS.desvinculado,
          ),
        ),
      );
    });
  });

  it("el mercaderista no puede resolver su propia solicitud (solo el staff)", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await c.query(
        ...insertar(
          IDS.nuevaSolicitud,
          TENANTS.maracumango,
          USUARIOS.mercaderistaMaracumango,
        ),
      );
      // No tiene política de UPDATE: el USING no la ve para escribir → 0 filas.
      const r = await c.query(
        "update public.solicitud_cambio_ruta set estado = 'resuelta' where id = $1",
        [IDS.nuevaSolicitud],
      );
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("formulario de levantamiento — config del admin, publicar congela", () => {
  it("una versión PUBLICADA es inmutable (trigger)", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query(
        `insert into public.formulario_levantamiento (id, tenant_id, nombre)
         values ($1, $2, 'Formulario piloto')`,
        [IDS.nuevoFormulario, TENANTS.maracumango],
      );
      await c.query(
        `insert into public.formulario_version
           (id, tenant_id, formulario_id, version, definicion, publicada)
         values ($1, $2, $3, 1, '{"pasos":[]}'::jsonb, true)`,
        [IDS.nuevaVersionForm, TENANTS.maracumango, IDS.nuevoFormulario],
      );
      // Editar una versión ya publicada dispara el trigger de inmutabilidad.
      await esRechazado(() =>
        c.query(
          `update public.formulario_version set definicion = '{"pasos":[1]}'::jsonb where id = $1`,
          [IDS.nuevaVersionForm],
        ),
      );
    });
  });

  it("el mercaderista no puede crear un formulario (solo el admin)", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await esRechazado(() =>
        c.query(
          `insert into public.formulario_levantamiento (id, tenant_id, nombre)
           values ($1, $2, 'Intruso')`,
          [IDS.nuevoFormulario, TENANTS.maracumango],
        ),
      );
    });
  });
});
