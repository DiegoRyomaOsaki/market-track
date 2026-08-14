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
  nuevaRespuesta: "e0000042-0000-0000-0000-000000000099",
  otraRespuesta: "e0000045-0000-0000-0000-000000000099",
  levantamientoMrc: "a0000011-0000-0000-0000-000000000001",
  levantamientoRival: "b0000011-0000-0000-0000-000000000002",
  nuevoPortalModulo: "e0000043-0000-0000-0000-000000000099",
  visitaMrc: "a0000010-0000-0000-0000-000000000001",
  nuevaFoto: "e0000015-0000-0000-0000-000000000099",
  otraFoto: "e0000015-0000-0000-0000-000000000098",
  nuevaContingencia: "e0000014-0000-0000-0000-000000000099",
  visitaDeCompanero: "e0000010-0000-0000-0000-000000000098",
  nuevaRespuestaVisita: "e0000046-0000-0000-0000-000000000099",
  nuevoFormularioCheckIn: "e0000047-0000-0000-0000-000000000099",
  formularioRival: "e0000048-0000-0000-0000-000000000099",
  versionFormRival: "e0000049-0000-0000-0000-000000000099",
  formularioPropio: "e0000050-0000-0000-0000-000000000099",
  versionFormPropia: "e0000051-0000-0000-0000-000000000099",
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

  it("la base rechaza una definición enorme aunque no pase por Zod", async () => {
    // `authenticated` tiene GRANT de insert sobre esta tabla y la política deja
    // escribir a cualquier admin: una llamada por PostgREST no toca los esquemas
    // de `packages/shared`. La estructura se sigue confiando a Zod, pero el
    // TAMAÑO no puede, porque cada versión publicada se replica a todos los
    // teléfonos. El techo son 256 KB, igual que `TOPES_FORMULARIO.bytesTotal`.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query(
        `insert into public.formulario_levantamiento (id, tenant_id, nombre)
         values ($1, $2, 'Para el tope')`,
        [IDS.nuevoFormulario, TENANTS.maracumango],
      );
      await esRechazado(() =>
        c.query(
          `insert into public.formulario_version
             (tenant_id, formulario_id, version, definicion)
           values ($1, $2, 9, jsonb_build_object('relleno', repeat('x', 300000)))`,
          [TENANTS.maracumango, IDS.nuevoFormulario],
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

  it("un formulario de check-in no puede colgar de una marca (CHECK)", async () => {
    // El check-in es de la VISITA. La verja es de la base, no solo del Zod del
    // panel: una llamada directa por PostgREST tampoco puede crearlo.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const marca = await c.query<{ id: string }>(
        `select id from public.marca where tenant_id = $1 limit 1`,
        [TENANTS.maracumango],
      );
      await expect(
        c.query(
          `insert into public.formulario_levantamiento (id, tenant_id, nombre, ambito, marca_id)
           values ($1, $2, 'Checklist mal colgado', 'check_in', $3)`,
          [IDS.nuevoFormularioCheckIn, TENANTS.maracumango, marca.rows[0]!.id],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "formulario_check_in_sin_marca",
      });
    });
  });

  it("el admin crea un formulario de check-in sin marca", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await c.query(
        `insert into public.formulario_levantamiento (id, tenant_id, nombre, ambito)
         values ($1, $2, 'Checklist de herramientas', 'check_in')`,
        [IDS.nuevoFormularioCheckIn, TENANTS.maracumango],
      );
      expect(r.rowCount).toBe(1);
    });
  });
});

describe("visita_respuesta — el checklist del check-in", () => {
  it("el mercaderista guarda una respuesta del checklist en SU visita", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const r = await c.query(
        `insert into public.visita_respuesta (id, tenant_id, visita_id, campo_id, valor)
         values ($1, $2, $3, 'llevas_botas', 'true'::jsonb)`,
        [IDS.nuevaRespuestaVisita, TENANTS.maracumango, IDS.visitaMrc],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("NO puede contestar el check-in de un COMPAÑERO del mismo cliente", async () => {
    // Visita del MISMO tenant a propósito: la FK compuesta pasa y lo único que
    // puede rechazar es el WITH CHECK, que exige ser el dueño de la visita.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await c.query("set local role postgres");
      await c.query(
        `insert into public.visita
           (id, tenant_id, rutero_parada_id, mercaderista_id, tienda_id, estado)
         values ($1, $2, $3, $4, $5, 'en_curso')`,
        [
          IDS.visitaDeCompanero,
          TENANTS.maracumango,
          IDS.ruteroParadaMrc,
          USUARIOS.desvinculado,
          IDS.tiendaMrc,
        ],
      );
      await c.query("set local role authenticated");

      await esRechazado(() =>
        c.query(
          `insert into public.visita_respuesta (id, tenant_id, visita_id, campo_id, valor)
           values ($1, $2, $3, 'llevas_botas', 'true'::jsonb)`,
          [
            IDS.nuevaRespuestaVisita,
            TENANTS.maracumango,
            IDS.visitaDeCompanero,
          ],
        ),
      );
    });
  });

  it("el DESVINCULADO no inserta: la revocación llega al checklist", async () => {
    // tenant_actual() es null para él → `tenant_id = tenant_actual()` falla
    // cerrado aunque conociera una visita del tenant.
    await comoUsuario(db, USUARIOS.desvinculado, async (c) => {
      await esRechazado(() =>
        c.query(
          `insert into public.visita_respuesta (id, tenant_id, visita_id, campo_id, valor)
           values ($1, $2, $3, 'llevas_botas', 'true'::jsonb)`,
          [IDS.nuevaRespuestaVisita, TENANTS.maracumango, IDS.visitaMrc],
        ),
      );
    });
  });

  it("la base rechaza una respuesta enorme aunque no pase por la app", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await expect(
        c.query(
          `insert into public.visita_respuesta (id, tenant_id, visita_id, campo_id, valor)
           values ($1, $2, $3, 'notas', to_jsonb(repeat('x', 20000)))`,
          [IDS.nuevaRespuestaVisita, TENANTS.maracumango, IDS.visitaMrc],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "visita_respuesta_valor_tamano",
      });
    });
  });

  it("puede corregir el VALOR pero no mover la respuesta de campo (trigger)", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await c.query(
        `insert into public.visita_respuesta (id, tenant_id, visita_id, campo_id, valor)
         values ($1, $2, $3, 'llevas_botas', 'true'::jsonb)`,
        [IDS.nuevaRespuestaVisita, TENANTS.maracumango, IDS.visitaMrc],
      );
      const ok = await c.query(
        `update public.visita_respuesta set valor = 'false'::jsonb where id = $1`,
        [IDS.nuevaRespuestaVisita],
      );
      expect(ok.rowCount).toBe(1);
      await esRechazado(() =>
        c.query(
          `update public.visita_respuesta set campo_id = 'otro' where id = $1`,
          [IDS.nuevaRespuestaVisita],
        ),
      );
    });
  });

  it("el upsert de reintento de PowerSync pasa el trigger", async () => {
    // El conector reenvía la fila ENTERA con `on conflict do update`: mismos
    // valores de identidad, `is distinct from` no salta.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await c.query(
        `insert into public.visita_respuesta (id, tenant_id, visita_id, campo_id, valor, creado_at)
         values ($1, $2, $3, 'llevas_botas', 'true'::jsonb, '2026-08-13T09:00:00Z')`,
        [IDS.nuevaRespuestaVisita, TENANTS.maracumango, IDS.visitaMrc],
      );
      const r = await c.query(
        `insert into public.visita_respuesta (id, tenant_id, visita_id, campo_id, valor, creado_at)
         values ($1, $2, $3, 'llevas_botas', 'false'::jsonb, '2026-08-13T09:00:00Z')
         on conflict (id) do update set
           tenant_id = excluded.tenant_id, visita_id = excluded.visita_id,
           campo_id = excluded.campo_id, valor = excluded.valor,
           creado_at = excluded.creado_at`,
        [IDS.nuevaRespuestaVisita, TENANTS.maracumango, IDS.visitaMrc],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("el supervisor lee el checklist; el cliente-marca y el rival, no", async () => {
    // Las respuestas ("llevas botas") son el mismo dato laboral que su foto: al
    // cliente-marca se le ocultan las dos, por la política, no por la pantalla.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await c.query(
        `insert into public.visita_respuesta (id, tenant_id, visita_id, campo_id, valor)
         values ($1, $2, $3, 'llevas_botas', 'true'::jsonb)`,
        [IDS.nuevaRespuestaVisita, TENANTS.maracumango, IDS.visitaMrc],
      );
      const suplantar = (sub: string) =>
        c.query(
          `set local request.jwt.claims = '${JSON.stringify({
            sub,
            role: "authenticated",
            aal: "aal2",
          })}'`,
        );
      const cuenta = async () =>
        (
          await c.query(
            `select id from public.visita_respuesta where id = $1`,
            [IDS.nuevaRespuestaVisita],
          )
        ).rowCount;

      await suplantar(USUARIOS.supervisor);
      expect(await cuenta()).toBe(1);

      await suplantar(USUARIOS.clienteMaracumango);
      expect(await cuenta()).toBe(0);

      await suplantar(USUARIOS.mercaderistaRival);
      expect(await cuenta()).toBe(0);
    });
  });

  it("borrar la visita arrastra sus respuestas (cascade)", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await c.query(
        `insert into public.visita_respuesta (id, tenant_id, visita_id, campo_id, valor)
         values ($1, $2, $3, 'llevas_botas', 'true'::jsonb)`,
        [IDS.nuevaRespuestaVisita, TENANTS.maracumango, IDS.visitaMrc],
      );
      await c.query("set local role postgres");
      await c.query(`delete from public.visita where id = $1`, [IDS.visitaMrc]);
      const r = await c.query(
        `select id from public.visita_respuesta where id = $1`,
        [IDS.nuevaRespuestaVisita],
      );
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("foto de campo configurable — tipo campo_extra", () => {
  // La respuesta de un campo foto guarda el uuid de la fila `foto` en su `valor`
  // jsonb, sin FK: el enlace lo resuelve cualquier lectura bajo RLS. Este par de
  // escrituras es exactamente lo que sube el móvil al continuar el paso, y fija
  // que el enum nuevo no necesita ni grant ni política nueva.
  it("el mercaderista inserta la foto campo_extra y la respuesta que la referencia", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const foto = await c.query(
        `insert into public.foto (id, tenant_id, visita_id, levantamiento_id, tipo, capturada_at)
         values ($1, $2, $3, $4, 'campo_extra', now())`,
        [
          IDS.nuevaFoto,
          TENANTS.maracumango,
          IDS.visitaMrc,
          IDS.levantamientoMrc,
        ],
      );
      expect(foto.rowCount).toBe(1);

      const respuesta = await c.query(
        `insert into public.levantamiento_respuesta (id, tenant_id, levantamiento_id, campo_id, valor)
         values ($1, $2, $3, 'foto_gondola', to_jsonb($4::text))`,
        [
          IDS.nuevaRespuesta,
          TENANTS.maracumango,
          IDS.levantamientoMrc,
          IDS.nuevaFoto,
        ],
      );
      expect(respuesta.rowCount).toBe(1);
    });
  });
});

describe("levantamiento_respuesta — el mercaderista escribe lo que levanta", () => {
  it("el mercaderista guarda una respuesta en SU levantamiento", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const r = await c.query(
        `insert into public.levantamiento_respuesta (id, tenant_id, levantamiento_id, campo_id, valor)
         values ($1, $2, $3, 'temperatura', '4.5'::jsonb)`,
        [IDS.nuevaRespuesta, TENANTS.maracumango, IDS.levantamientoMrc],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("la base rechaza una respuesta enorme aunque no pase por la app", async () => {
    // El mercaderista es el actor de menor confianza y el único que escribe
    // desde un dispositivo que no controlamos. La app trunca al coercionar y el
    // campo de la pantalla limita lo tecleable, pero ninguna de esas dos verjas
    // existe para una sesión comprometida que hable con PostgREST. Y esto es una
    // fila por campo, por levantamiento, por visita: lo que se cuele se
    // multiplica por toda la operación.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      // Se fija el código 23514 y el nombre del constraint: sin eso, el día que
      // una política o un trigger rechacen por otra razón, el test seguiría
      // verde sin proteger nada.
      await expect(
        c.query(
          `insert into public.levantamiento_respuesta (id, tenant_id, levantamiento_id, campo_id, valor)
           values ($1, $2, $3, 'texto_libre', to_jsonb(repeat('x', 20000)))`,
          [IDS.nuevaRespuesta, TENANTS.maracumango, IDS.levantamientoMrc],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "levantamiento_respuesta_valor_tamano",
      });
    });
  });

  it("puede corregir el valor de una respuesta suya", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await c.query(
        `insert into public.levantamiento_respuesta (id, tenant_id, levantamiento_id, campo_id, valor)
         values ($1, $2, $3, 'temperatura', '4.5'::jsonb)`,
        [IDS.nuevaRespuesta, TENANTS.maracumango, IDS.levantamientoMrc],
      );
      const r = await c.query(
        `update public.levantamiento_respuesta set valor = '6.0'::jsonb where id = $1`,
        [IDS.nuevaRespuesta],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  // Un caso por test: el primer error aborta la transacción del harness, así que
  // dos rechazos seguidos harían que el segundo fallara por "transaction is
  // aborted" en vez de por lo que se quiere probar.
  it.each([
    ["a otro campo", "campo_id = 'otro_campo'"],
    ["a otro levantamiento", `levantamiento_id = '${IDS.levantamientoRival}'`],
    ["a otro cliente", `tenant_id = '${TENANTS.rival}'`],
    ["a otro id", `id = '${IDS.otraRespuesta}'`],
    ["a otra hora de captura", "creado_at = now() - interval '3 days'"],
  ])("NO puede mover la respuesta %s", async (_caso, asignacion) => {
    // La app solo escribe `valor`, pero el `grant update` es de tabla y PostgREST
    // está abierto a cualquiera con la sesión: sin el trigger, un PATCH movería
    // la respuesta a otro campo y el registro dejaría de decir qué se contestó.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await c.query(
        `insert into public.levantamiento_respuesta (id, tenant_id, levantamiento_id, campo_id, valor)
         values ($1, $2, $3, 'temperatura', '4.5'::jsonb)`,
        [IDS.nuevaRespuesta, TENANTS.maracumango, IDS.levantamientoMrc],
      );
      await expect(
        c.query(
          `update public.levantamiento_respuesta set ${asignacion} where id = $1`,
          [IDS.nuevaRespuesta],
        ),
      ).rejects.toMatchObject({ code: "P0001" });
    });
  });

  it("NO puede mover la respuesta a OTRO LEVANTAMIENTO SUYO, que es el caso que solo para el trigger", async () => {
    // Los casos de arriba apuntan al tenant rival, así que la FK compuesta ya los
    // bloquearía aunque el trigger no existiera. Este es el escenario del ticket:
    // dos levantamientos de la MISMA visita del MISMO mercaderista (otra marca
    // del mismo cliente). La RLS pasa —ambos cuelgan de una visita suya— y la FK
    // también. Sin el trigger, la respuesta se movería de marca sin más.
    const OTRA_MARCA = "cccccccc-0000-0000-0000-000000000002";
    const otroLevantamiento = "e0000044-0000-0000-0000-000000000099";
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await c.query("set local role postgres");
      await c.query(
        `insert into public.levantamiento (id, tenant_id, visita_id, marca_id)
         values ($1, $2, (select visita_id from public.levantamiento where id = $3), $4)`,
        [
          otroLevantamiento,
          TENANTS.maracumango,
          IDS.levantamientoMrc,
          OTRA_MARCA,
        ],
      );
      await c.query("set local role authenticated");

      await c.query(
        `insert into public.levantamiento_respuesta (id, tenant_id, levantamiento_id, campo_id, valor)
         values ($1, $2, $3, 'temperatura', '4.5'::jsonb)`,
        [IDS.nuevaRespuesta, TENANTS.maracumango, IDS.levantamientoMrc],
      );
      await expect(
        c.query(
          `update public.levantamiento_respuesta set levantamiento_id = $2 where id = $1`,
          [IDS.nuevaRespuesta, otroLevantamiento],
        ),
      ).rejects.toMatchObject({ code: "P0001" });
    });
  });

  it("el trigger también aplica a service_role: la identidad no la mueve nadie", async () => {
    // `service_role` salta la RLS pero NO los triggers. Es deliberado: si algún
    // día una Edge Function necesita corregir una identidad, que tenga que
    // hacerlo a conciencia y no por accidente.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await c.query(
        `insert into public.levantamiento_respuesta (id, tenant_id, levantamiento_id, campo_id, valor)
         values ($1, $2, $3, 'temperatura', '4.5'::jsonb)`,
        [IDS.nuevaRespuesta, TENANTS.maracumango, IDS.levantamientoMrc],
      );
      await c.query("set local role service_role");
      await expect(
        c.query(
          `update public.levantamiento_respuesta set campo_id = 'otro' where id = $1`,
          [IDS.nuevaRespuesta],
        ),
      ).rejects.toMatchObject({ code: "P0001" });
    });
  });

  it("el upsert real de PowerSync (on conflict do update) pasa el trigger", async () => {
    // El test de abajo prueba la invariante con un UPDATE plano; este ejercita la
    // sentencia que de verdad emite el conector, para no dar por hecho que un
    // BEFORE UPDATE se dispara igual en la rama `do update` de un `on conflict`.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await c.query(
        `insert into public.levantamiento_respuesta (id, tenant_id, levantamiento_id, campo_id, valor)
         values ($1, $2, $3, 'temperatura', '4.5'::jsonb)`,
        [IDS.nuevaRespuesta, TENANTS.maracumango, IDS.levantamientoMrc],
      );
      const r = await c.query(
        `insert into public.levantamiento_respuesta (id, tenant_id, levantamiento_id, campo_id, valor)
         values ($1, $2, $3, 'temperatura', '9.9'::jsonb)
         on conflict (id) do update set
           tenant_id = excluded.tenant_id,
           levantamiento_id = excluded.levantamiento_id,
           campo_id = excluded.campo_id,
           valor = excluded.valor`,
        [IDS.nuevaRespuesta, TENANTS.maracumango, IDS.levantamientoMrc],
      );
      expect(r.rowCount).toBe(1);
      const leido = await c.query<{ valor: string }>(
        `select valor::text as valor from public.levantamiento_respuesta where id = $1`,
        [IDS.nuevaRespuesta],
      );
      expect(leido.rows[0]?.valor).toBe("9.9");
    });
  });

  it("el reintento de PowerSync sigue funcionando: reescribir lo mismo pasa", async () => {
    // Es la razón de que esto sea un trigger y no `grant update (valor)`. El
    // conector reenvía como `upsert({...opData, id})`, que sobre una fila que ya
    // existe actualiza TODAS las columnas. Un grant por columna daría 42501, que
    // el conector clasifica como rechazo definitivo: descartaría la operación y
    // el mercaderista perdería la respuesta que capturó en tienda.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await c.query(
        `insert into public.levantamiento_respuesta (id, tenant_id, levantamiento_id, campo_id, valor)
         values ($1, $2, $3, 'temperatura', '4.5'::jsonb)`,
        [IDS.nuevaRespuesta, TENANTS.maracumango, IDS.levantamientoMrc],
      );
      // El upsert del reintento: mismas columnas de identidad, valor nuevo.
      const r = await c.query(
        `update public.levantamiento_respuesta
         set tenant_id = $2, levantamiento_id = $3, campo_id = 'temperatura',
             valor = '7.5'::jsonb
         where id = $1`,
        [IDS.nuevaRespuesta, TENANTS.maracumango, IDS.levantamientoMrc],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("NO puede guardar una respuesta en el levantamiento de otro cliente", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      // Fila 100% coherente con el rival (levantamiento y tenant del rival): la FK
      // compuesta pasa. Lo único que bloquea es el WITH CHECK, que exige que el
      // levantamiento cuelgue de una visita del propio mercaderista.
      await esRechazado(() =>
        c.query(
          `insert into public.levantamiento_respuesta (id, tenant_id, levantamiento_id, campo_id, valor)
           values ($1, $2, $3, 'temperatura', '4.5'::jsonb)`,
          [IDS.nuevaRespuesta, TENANTS.rival, IDS.levantamientoRival],
        ),
      );
    });
  });

  it("puede ACTUALIZAR una respuesta de su propio levantamiento", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await c.query(
        `insert into public.levantamiento_respuesta (id, tenant_id, levantamiento_id, campo_id, valor)
         values ($1, $2, $3, 'temperatura', '4.5'::jsonb)`,
        [IDS.nuevaRespuesta, TENANTS.maracumango, IDS.levantamientoMrc],
      );
      // Ejercita levresp_mercaderista_actualiza (USING + WITH CHECK): su fila.
      const r = await c.query(
        `update public.levantamiento_respuesta set valor = '5.0'::jsonb where id = $1`,
        [IDS.nuevaRespuesta],
      );
      expect(r.rowCount).toBe(1);
    });
  });
});

describe("portal_modulo_habilitado — solo el admin configura el portal del cliente", () => {
  const insertar = (tenantId: string): [string, unknown[]] => [
    `insert into public.portal_modulo_habilitado (id, tenant_id, modulo, habilitado)
     values ($1, $2, 'dashboard', false)`,
    [IDS.nuevoPortalModulo, tenantId],
  ];

  // Re-habilitar/deshabilitar es un UPDATE de la fila (tenant, modulo), no un
  // INSERT: la clave del upsert. En una política `for all`, un UPDATE que no pasa
  // el USING devuelve 0 filas EN SILENCIO (no revienta como el INSERT), así que
  // el camino de escritura se cubre por separado.
  it("el admin deshabilita (INSERT) un módulo para un cliente", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await c.query(...insertar(TENANTS.maracumango));
      expect(r.rowCount).toBe(1);
    });
  });

  it("el admin configura CUALQUIER cliente: su política de escritura no está acotada por tenant", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await c.query(...insertar(TENANTS.rival));
      expect(r.rowCount).toBe(1);
    });
  });

  it("el admin re-habilita (UPDATE) un módulo ya deshabilitado", async () => {
    // `reportes` de Maracumango viene deshabilitado del seed: togglearlo es UPDATE.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await c.query(
        `update public.portal_modulo_habilitado set habilitado = true
         where tenant_id = $1 and modulo = 'reportes'`,
        [TENANTS.maracumango],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("el CLIENTE no puede INSERTAR config (solo lee)", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      // Fila coherente con su tenant: la única verja es el WITH CHECK rol='admin'.
      await esRechazado(() => c.query(...insertar(TENANTS.maracumango)));
    });
  });

  it("el CLIENTE tampoco puede ACTUALIZAR su config (el USING la oculta: 0 filas, no error)", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      const r = await c.query(
        `update public.portal_modulo_habilitado set habilitado = true
         where tenant_id = $1 and modulo = 'reportes'`,
        [TENANTS.maracumango],
      );
      expect(r.rowCount).toBe(0);
    });
  });

  it("el mercaderista tampoco puede configurar el portal", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await esRechazado(() => c.query(...insertar(TENANTS.maracumango)));
    });
  });
});

describe("foto — la metadata sube por el sync, el binario por su propia cola", () => {
  const SQL_FOTO = `insert into public.foto (id, visita_id, tipo, hash, capturada_at)
     values ($1, $2, 'antes', 'sha', now())`;
  const insertar = (c: Client, fotoId: string, visitaId: string) =>
    c.query(SQL_FOTO, [fotoId, visitaId]);

  it("el mercaderista crea la foto de SU visita sin pasar tenant_id", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await insertar(c, IDS.nuevaFoto, IDS.visitaMrc);

      const r = await c.query<{ tenant_id: string }>(
        `select tenant_id from public.foto where id = $1`,
        [IDS.nuevaFoto],
      );
      expect(r.rows[0]?.tenant_id).toBe(TENANTS.maracumango);
    });
  });

  it("NO puede colgar una foto de la visita de un COMPAÑERO del mismo cliente", async () => {
    // La visita es del MISMO tenant a propósito: así la FK compuesta está
    // satisfecha y lo único que puede rechazar el insert es el WITH CHECK de la
    // política, que exige ser el DUEÑO de la visita (más estricto que el tenant).
    // Con una visita del tenant rival, el test pasaría por la FK aunque alguien
    // abriera la política — verificado abriéndola.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await c.query("set local role postgres");
      await c.query(
        `insert into public.visita
           (id, tenant_id, rutero_parada_id, mercaderista_id, tienda_id, estado)
         values ($1, $2, $3, $4, $5, 'en_curso')`,
        [
          IDS.visitaDeCompanero,
          TENANTS.maracumango,
          IDS.ruteroParadaMrc,
          USUARIOS.desvinculado,
          IDS.tiendaMrc,
        ],
      );
      await c.query("set local role authenticated");

      await esRechazado(() =>
        insertar(c, IDS.nuevaFoto, IDS.visitaDeCompanero),
      );
    });
  });

  it("marca su propia foto como subida", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await insertar(c, IDS.nuevaFoto, IDS.visitaMrc);

      const r = await c.query(
        `update public.foto set subida_at = now() where id = $1`,
        [IDS.nuevaFoto],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("el upsert de PowerSync sobre una foto ya existente no revienta", async () => {
    // El conector reenvía con `on conflict do update`: un reintento tras un fallo
    // de red vuelve a mandar la fila entera.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await insertar(c, IDS.nuevaFoto, IDS.visitaMrc);
      await c.query(
        `insert into public.foto (id, tenant_id, visita_id, tipo, hash, capturada_at)
         values ($1, $2, $3, 'antes', 'sha', now())
         on conflict (id) do update set hash = excluded.hash`,
        [IDS.nuevaFoto, TENANTS.maracumango, IDS.visitaMrc],
      );

      const r = await c.query<{ n: string }>(
        `select count(*)::text as n from public.foto where id = $1`,
        [IDS.nuevaFoto],
      );
      expect(r.rows[0]?.n).toBe("1");
    });
  });

  it("una contingencia CON foto se inserta si la fila `foto` existe", async () => {
    // El bug que este ticket arregla: sin la fila, `cont_foto_fk` rechaza el
    // insert con 23503, el conector lo trata como definitivo y descarta la
    // operación entera — la contingencia con foto no llegaba nunca y el
    // supervisor no recibía su alerta de bypass.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await insertar(c, IDS.nuevaFoto, IDS.visitaMrc);

      await c.query(
        `insert into public.contingencia
           (id, visita_id, levantamiento_id, paso, motivo, registrada_at, foto_id)
         values ($1, $2, $3, 'precios', 'Góndola bloqueada', now(), $4)`,
        [
          IDS.nuevaContingencia,
          IDS.visitaMrc,
          IDS.levantamientoMrc,
          IDS.nuevaFoto,
        ],
      );

      const r = await c.query<{ foto_id: string }>(
        `select foto_id from public.contingencia where id = $1`,
        [IDS.nuevaContingencia],
      );
      expect(r.rows[0]?.foto_id).toBe(IDS.nuevaFoto);
    });
  });

  it("sin la fila `foto`, la contingencia se rechaza con la FK: el bug congelado", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await expect(
        c.query(
          `insert into public.contingencia
             (id, visita_id, levantamiento_id, paso, motivo, registrada_at, foto_id)
           values ($1, $2, $3, 'precios', 'Góndola bloqueada', now(), $4)`,
          [
            IDS.nuevaContingencia,
            IDS.visitaMrc,
            IDS.levantamientoMrc,
            IDS.otraFoto,
          ],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    });
  });
});

describe("formulario_version_id — el ancla no cruza clientes", () => {
  // Las FK simples solo miran el id: un cliente hostil podía anclar su visita o
  // su levantamiento a la versión de OTRO cliente por PostgREST, y el motor de
  // puntaje (SECURITY DEFINER, salta RLS) sacaría el denominador de "calidad" y
  // "herramientas" de un formulario ajeno — y de esas variables sale un bono.
  // La verja es la FK compuesta (id, tenant_id); la RLS no interviene ahí.

  /** Un formulario con su versión publicada, en el tenant que se pida. */
  async function sembrarVersion(
    c: Client,
    tenantId: string,
    formularioId: string,
    versionId: string,
  ): Promise<void> {
    await c.query("set local role postgres");
    await c.query(
      `insert into public.formulario_levantamiento (id, tenant_id, nombre)
       values ($1, $2, 'Para el ancla')`,
      [formularioId, tenantId],
    );
    await c.query(
      `insert into public.formulario_version
         (id, tenant_id, formulario_id, version, definicion, publicada)
       values ($1, $2, $3, 1, '{"pasos":[]}'::jsonb, true)`,
      [versionId, tenantId, formularioId],
    );
    await c.query("set local role authenticated");
  }

  it("la visita NO se puede anclar a la versión de OTRO cliente", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await sembrarVersion(
        c,
        TENANTS.rival,
        IDS.formularioRival,
        IDS.versionFormRival,
      );
      await expect(
        c.query(
          `update public.visita set formulario_version_id = $2 where id = $1`,
          [IDS.visitaMrc, IDS.versionFormRival],
        ),
      ).rejects.toMatchObject({
        code: "23503",
        constraint: "visita_formver_fk",
      });
    });
  });

  it("el levantamiento tampoco", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await sembrarVersion(
        c,
        TENANTS.rival,
        IDS.formularioRival,
        IDS.versionFormRival,
      );
      await expect(
        c.query(
          `update public.levantamiento set formulario_version_id = $2 where id = $1`,
          [IDS.levantamientoMrc, IDS.versionFormRival],
        ),
      ).rejects.toMatchObject({ code: "23503", constraint: "lev_formver_fk" });
    });
  });

  it("a una versión del PROPIO cliente sí se ancla", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await sembrarVersion(
        c,
        TENANTS.maracumango,
        IDS.formularioPropio,
        IDS.versionFormPropia,
      );
      const r = await c.query(
        `update public.visita set formulario_version_id = $2 where id = $1`,
        [IDS.visitaMrc, IDS.versionFormPropia],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("el levantamiento también se ancla a una versión del PROPIO cliente", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await sembrarVersion(
        c,
        TENANTS.maracumango,
        IDS.formularioPropio,
        IDS.versionFormPropia,
      );
      const r = await c.query(
        `update public.levantamiento set formulario_version_id = $2 where id = $1`,
        [IDS.levantamientoMrc, IDS.versionFormPropia],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("una visita SIN formulario anclado sigue siendo válida (el ancla es opcional)", async () => {
    // El guardián contra un MATCH FULL por error: con él, todo par (null,
    // tenant_id) sería rechazado y el check-in sin checklist —el caso normal—
    // dejaría de sincronizar, descartando datos de campo.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const r = await c.query(
        `update public.visita set formulario_version_id = null where id = $1`,
        [IDS.visitaMrc],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("y un levantamiento SIN formulario también", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const r = await c.query(
        `update public.levantamiento set formulario_version_id = null where id = $1`,
        [IDS.levantamientoMrc],
      );
      expect(r.rowCount).toBe(1);
    });
  });
});
