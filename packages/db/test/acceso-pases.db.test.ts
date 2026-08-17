import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, USUARIOS } from "./ayudas";

// El pase de acceso temporal: quien emite uno puede entrar como ese mercaderista.
// Es el camino más sensible del sistema de auth, así que casi todo lo que se
// prueba aquí es lo que NO se puede hacer.

const JOSE = USUARIOS.mercaderistaMaracumango;

type FilaBitacora = {
  id: string;
  profile_id: string;
  usuario_nombre: string | null;
  emisor_nombre: string | null;
  motivo: string;
  estado: string;
  generado_at: string;
  expira_at: string;
};

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

async function bitacora(
  c: Client,
  args: { profileId?: string; estado?: string; limite?: number } = {},
): Promise<FilaBitacora[]> {
  const r = await c.query<FilaBitacora>(
    `select * from public.bitacora_pases($1, $2::public.estado_pase, $3)`,
    [args.profileId ?? null, args.estado ?? null, args.limite ?? 50],
  );
  return r.rows;
}

/**
 * Siembra un pase como lo haría la Edge Function (service_role, saltando RLS).
 * Los estados terminales no se pueden insertar por la política endurecida — que
 * es justo lo que se quiere—, así que aquí se escriben con el rol de la base.
 */
async function sembrarPase(
  c: Client,
  p: {
    id: string;
    profileId?: string;
    motivo?: string;
    generadoPor?: string;
    generadoAt?: string;
    expiraAt?: string;
    usadoAt?: string | null;
    revocadoAt?: string | null;
    codigoHash?: string;
    /** La sesión que lo canjeó. Un pase usado siempre la lleva (CHECK). */
    usadoPorSesion?: string;
  },
): Promise<void> {
  await c.query("set local role postgres");
  await c.query(
    `insert into public.pase_acceso_temporal
       (id, profile_id, codigo_hash, motivo, generado_por,
        generado_at, expira_at, usado_at, revocado_at, usado_por_sesion)
     values ($1, $2, $9, $3, $4,
             coalesce($5::timestamptz, now()),
             coalesce($6::timestamptz, now() + interval '15 minutes'),
             $7::timestamptz, $8::timestamptz,
             case when $7::timestamptz is null then null
                  else coalesce($10::uuid, gen_random_uuid()) end)`,
    [
      p.id,
      p.profileId ?? JOSE,
      p.motivo ?? "No le llega el OTP",
      p.generadoPor ?? USUARIOS.supervisor,
      p.generadoAt ?? null,
      p.expiraAt ?? null,
      p.usadoAt ?? null,
      p.revocadoAt ?? null,
      p.codigoHash ?? "hash-de-prueba",
      p.usadoPorSesion ?? null,
    ],
  );
  await c.query("set local role authenticated");
}

/**
 * Corre algo que DEBE fallar, aislado en un savepoint.
 *
 * Sin esto, el primer error aborta la transacción del test y todo lo que venga
 * después falla con «current transaction is aborted» — un rojo que no dice nada
 * de lo que se quería probar.
 */
async function alIntentar(c: Client, sql: string, params: unknown[] = []) {
  await c.query("savepoint intento");
  try {
    await c.query(sql, params);
    await c.query("release savepoint intento");
    return null;
  } catch (e) {
    await c.query("rollback to savepoint intento");
    return e instanceof Error ? e.message : String(e);
  }
}

describe("el código del pase nunca sale", () => {
  it("pedir la tabla entera falla: `codigo_hash` no tiene grant de lectura", async () => {
    // Quien emite un pase puede entrar como ese mercaderista, así que ni el admin
    // guarda el secreto. Es un contrato de seguridad, no una preferencia: si
    // alguien añadiera la columna al grant, este test se cae.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const error = await alIntentar(
        c,
        "select * from public.pase_acceso_temporal",
      );
      expect(error).toMatch(/permission denied|codigo_hash/i);
    });
  });

  it("la bitácora no lo devuelve por ninguna columna", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await sembrarPase(c, { id: "e0000019-0000-0000-0000-00000000a001" });
      const filas = await bitacora(c);
      expect(Object.keys(filas[0] ?? {})).not.toContain("codigo_hash");
    });
  });
});

describe("bitacora_pases — quién ve qué", () => {
  it("el admin ve los pases de cualquier mercaderista", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await sembrarPase(c, { id: "e0000019-0000-0000-0000-00000000b001" });
      expect((await bitacora(c)).map((f) => f.id)).toContain(
        "e0000019-0000-0000-0000-00000000b001",
      );
    });
  });

  it("el supervisor ve los de SUS mercaderistas", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await sembrarPase(c, { id: "e0000019-0000-0000-0000-00000000b002" });
      expect((await bitacora(c)).map((f) => f.id)).toContain(
        "e0000019-0000-0000-0000-00000000b002",
      );
    });
  });

  it("OTRO supervisor NO los ve, aunque también sea staff", async () => {
    // El test que da sentido a los dos de arriba. Con `es_staff()` —como estaba—
    // este pase sería visible: el rol basta, el equipo no se miraba.
    await comoUsuario(db, USUARIOS.supervisorSinEquipo, async (c) => {
      await sembrarPase(c, { id: "e0000019-0000-0000-0000-00000000b003" });
      expect(await bitacora(c)).toEqual([]);
    });
  });

  it("ni el cliente ni el mercaderista ven la bitácora", async () => {
    for (const usuario of [
      USUARIOS.clienteMaracumango,
      USUARIOS.mercaderistaMaracumango,
    ]) {
      await comoUsuario(db, usuario, async (c) => {
        await sembrarPase(c, { id: "e0000019-0000-0000-0000-00000000b004" });
        expect(await bitacora(c)).toEqual([]);
      });
    }
  });
});

describe("bitacora_pases — el estado derivado", () => {
  it("deriva los cuatro estados de las marcas de tiempo", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await sembrarPase(c, { id: "e0000019-0000-0000-0000-00000000c001" });
      await sembrarPase(c, {
        id: "e0000019-0000-0000-0000-00000000c002",
        usadoAt: "now()",
      });
      await sembrarPase(c, {
        id: "e0000019-0000-0000-0000-00000000c003",
        revocadoAt: "now()",
      });
      await sembrarPase(c, {
        id: "e0000019-0000-0000-0000-00000000c004",
        generadoAt: "2026-01-01T10:00:00Z",
        expiraAt: "2026-01-01T10:15:00Z",
      });

      const porId = new Map(
        (await bitacora(c)).map((f) => [f.id, f.estado] as const),
      );
      expect(porId.get("e0000019-0000-0000-0000-00000000c001")).toBe("vigente");
      expect(porId.get("e0000019-0000-0000-0000-00000000c002")).toBe("usado");
      expect(porId.get("e0000019-0000-0000-0000-00000000c003")).toBe(
        "revocado",
      );
      expect(porId.get("e0000019-0000-0000-0000-00000000c004")).toBe("vencido");
    });
  });

  it("un pase usado sigue siendo «usado» aunque también esté vencido", async () => {
    // La precedencia importa: un pase que se usó y luego expiró se usó, y eso es
    // lo que hay que poder auditar.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await sembrarPase(c, {
        id: "e0000019-0000-0000-0000-00000000c005",
        generadoAt: "2026-01-01T10:00:00Z",
        expiraAt: "2026-01-01T10:15:00Z",
        usadoAt: "2026-01-01T10:05:00Z",
      });
      const suyo = (await bitacora(c)).find(
        (f) => f.id === "e0000019-0000-0000-0000-00000000c005",
      );
      expect(suyo?.estado).toBe("usado");
    });
  });

  it("filtra por estado y por usuario", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await sembrarPase(c, { id: "e0000019-0000-0000-0000-00000000c006" });
      await sembrarPase(c, {
        id: "e0000019-0000-0000-0000-00000000c007",
        revocadoAt: "now()",
      });

      const revocados = await bitacora(c, { estado: "revocado" });
      expect(revocados.every((f) => f.estado === "revocado")).toBe(true);
      expect(revocados.map((f) => f.id)).toContain(
        "e0000019-0000-0000-0000-00000000c007",
      );

      const deJose = await bitacora(c, { profileId: JOSE });
      expect(deJose.every((f) => f.profile_id === JOSE)).toBe(true);
    });
  });

  it("trae el nombre del usuario y el de quien lo emitió", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await sembrarPase(c, { id: "e0000019-0000-0000-0000-00000000c008" });
      const suyo = (await bitacora(c)).find(
        (f) => f.id === "e0000019-0000-0000-0000-00000000c008",
      );
      expect(suyo?.usuario_nombre).toBeTruthy();
      expect(suyo?.emisor_nombre).toBeTruthy();
    });
  });

  it("acota el tope: la RPC es alcanzable sin pasar por la UI", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      expect(
        (await bitacora(c, { limite: 100000 })).length,
      ).toBeLessThanOrEqual(200);
    });
  });
});

describe("quién puede emitir un pase, por la política de verdad", () => {
  // Todo lo demás de este archivo siembra con `set local role postgres` para
  // poder fabricar estados terminales. Estos casos NO: pasan por la RLS como lo
  // haría PostgREST, que es el único camino que prueba el `with check`.

  it("el admin emite un pase a un mercaderista", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await c.query(
        `insert into public.pase_acceso_temporal
           (profile_id, codigo_hash, motivo, generado_por)
         values ($1, 'h', 'No le llega el OTP', $2) returning id`,
        [JOSE, USUARIOS.admin],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("el supervisor emite a SU mercaderista", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const r = await c.query(
        `insert into public.pase_acceso_temporal
           (profile_id, codigo_hash, motivo, generado_por)
         values ($1, 'h', 'Está en tienda sin señal', $2) returning id`,
        [JOSE, USUARIOS.supervisor],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("otro supervisor NO puede emitirle un pase al mercaderista ajeno", async () => {
    await comoUsuario(db, USUARIOS.supervisorSinEquipo, async (c) => {
      expect(
        await alIntentar(
          c,
          `insert into public.pase_acceso_temporal
             (profile_id, codigo_hash, motivo, generado_por)
           values ($1, 'h', 'no es mío', $2)`,
          [JOSE, USUARIOS.supervisorSinEquipo],
        ),
      ).toMatch(/row-level security/i);
    });
  });

  it("un mercaderista no se emite un pase a sí mismo", async () => {
    // Sería darse acceso permanente saltándose el segundo factor.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      expect(
        await alIntentar(
          c,
          `insert into public.pase_acceso_temporal
             (profile_id, codigo_hash, motivo, generado_por)
           values ($1, 'h', 'me lo doy yo', $1)`,
          [JOSE],
        ),
      ).toMatch(/row-level security/i);
    });
  });

  it("el pase es SOLO para mercaderistas, ni para staff ni para un cliente", async () => {
    // La Edge Function ya lo restringe así, pero por PostgREST directo un admin
    // podía emitirse uno para un supervisor, para otro admin o para el usuario de
    // un cliente — un camino a la sesión de cualquiera. La RLS es la última línea.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      for (const objetivo of [
        USUARIOS.supervisor,
        USUARIOS.admin,
        USUARIOS.clienteMaracumango,
      ]) {
        expect(
          await alIntentar(
            c,
            `insert into public.pase_acceso_temporal
               (profile_id, codigo_hash, motivo, generado_por)
             values ($1, 'h', 'escalada', $2)`,
            [objetivo, USUARIOS.admin],
          ),
        ).toMatch(/row-level security/i);
      }
    });
  });
});

describe("la bitácora no se puede reescribir", () => {
  it("nadie cambia el motivo ni quién emitió: eso es lo que la bitácora audita", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await sembrarPase(c, { id: "e0000019-0000-0000-0000-00000000d001" });

      expect(
        await alIntentar(
          c,
          `update public.pase_acceso_temporal set motivo = 'otra cosa' where id = $1`,
          ["e0000019-0000-0000-0000-00000000d001"],
        ),
      ).toMatch(/permission denied/i);

      expect(
        await alIntentar(
          c,
          `update public.pase_acceso_temporal set generado_por = $2 where id = $1`,
          ["e0000019-0000-0000-0000-00000000d001", USUARIOS.admin],
        ),
      ).toMatch(/permission denied/i);
    });
  });

  it("el admin no puede atribuirle un pase a otra persona", async () => {
    // Si el emisor no es quien inserta, la bitácora puede mentir sobre quién dio
    // acceso — que es la única pregunta que existe para responder.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      expect(
        await alIntentar(
          c,
          `insert into public.pase_acceso_temporal
             (profile_id, codigo_hash, motivo, generado_por)
           values ($1, 'h', 'me lo invento', $2)`,
          [JOSE, USUARIOS.supervisor],
        ),
      ).toMatch(/row-level security/i);
    });
  });
});

describe("la revocación va en una sola dirección", () => {
  it("el admin revoca un pase vigente y el reloj lo pone el servidor", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await sembrarPase(c, { id: "e0000019-0000-0000-0000-00000000e001" });

      // Se manda una fecha del año pasado a propósito: si el servidor la
      // aceptara, quedaría un hueco en el que el pase parecería haber estado vivo.
      await c.query(
        `update public.pase_acceso_temporal
         set revocado_at = timestamptz '2025-01-01 00:00:00Z' where id = $1`,
        ["e0000019-0000-0000-0000-00000000e001"],
      );

      const suyo = (await bitacora(c)).find(
        (f) => f.id === "e0000019-0000-0000-0000-00000000e001",
      );
      expect(suyo?.estado).toBe("revocado");

      await c.query("set local role postgres");
      const r = await c.query<{ anio: string }>(
        `select to_char(revocado_at, 'YYYY') as anio
         from public.pase_acceso_temporal where id = $1`,
        ["e0000019-0000-0000-0000-00000000e001"],
      );
      expect(r.rows[0]?.anio).not.toBe("2025");
    });
  });

  it("un pase revocado no se des-revoca", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await sembrarPase(c, {
        id: "e0000019-0000-0000-0000-00000000e002",
        revocadoAt: "now()",
      });
      expect(
        await alIntentar(
          c,
          `update public.pase_acceso_temporal set revocado_at = null where id = $1`,
          ["e0000019-0000-0000-0000-00000000e002"],
        ),
      ).toMatch(/des-revocar/i);
    });
  });

  it("un pase YA USADO no se revoca: revocarlo diría que nunca se usó", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await sembrarPase(c, {
        id: "e0000019-0000-0000-0000-00000000e003",
        usadoAt: "now()",
      });
      expect(
        await alIntentar(
          c,
          `update public.pase_acceso_temporal set revocado_at = now() where id = $1`,
          ["e0000019-0000-0000-0000-00000000e003"],
        ),
      ).toMatch(/vigente/i);
    });
  });

  it("un pase vencido tampoco: ya no da acceso, revocarlo solo ensucia", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await sembrarPase(c, {
        id: "e0000019-0000-0000-0000-00000000e004",
        generadoAt: "2026-01-01T10:00:00Z",
        expiraAt: "2026-01-01T10:15:00Z",
      });
      expect(
        await alIntentar(
          c,
          `update public.pase_acceso_temporal set revocado_at = now() where id = $1`,
          ["e0000019-0000-0000-0000-00000000e004"],
        ),
      ).toMatch(/vigente/i);
    });
  });

  it("el supervisor revoca el de SU mercaderista", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await sembrarPase(c, { id: "e0000019-0000-0000-0000-00000000e005" });
      const r = await c.query(
        `update public.pase_acceso_temporal set revocado_at = now()
         where id = $1 returning id`,
        ["e0000019-0000-0000-0000-00000000e005"],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("otro supervisor no puede revocarlo: no afecta a ninguna fila", async () => {
    // La RLS no da error, esconde la fila. Por eso lo que se afirma es el CONTEO:
    // una escritura que no toca nada y no falla es un éxito falso.
    await comoUsuario(db, USUARIOS.supervisorSinEquipo, async (c) => {
      await sembrarPase(c, { id: "e0000019-0000-0000-0000-00000000e006" });
      const r = await c.query(
        `update public.pase_acceso_temporal set revocado_at = now() where id = $1`,
        ["e0000019-0000-0000-0000-00000000e006"],
      );
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("los canales de OTP son una política global", () => {
  it("el admin los cambia", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await c.query(
        `update public.configuracion_plataforma
         set otp_canales_habilitados = '{correo,sms}' returning id`,
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("el CORREO no se puede desactivar: es el único canal que entrega", async () => {
    // Dejar la plataforma sin ningún canal cerraría la puerta a todo el mundo. La
    // regla vive aquí porque en la UI sería una convención que un POST se salta.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      expect(
        await alIntentar(
          c,
          `update public.configuracion_plataforma set otp_canales_habilitados = '{sms}'`,
        ),
      ).toMatch(/config_correo_siempre_habilitado/i);
    });
  });

  it("nadie escribe la marca de tiempo ni `otp_requerido`", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      expect(
        await alIntentar(
          c,
          `update public.configuracion_plataforma set actualizado_at = now()`,
        ),
      ).toMatch(/permission denied/i);
      expect(
        await alIntentar(
          c,
          `update public.configuracion_plataforma set otp_requerido = false`,
        ),
      ).toMatch(/permission denied/i);
    });
  });

  it("el cambio queda sellado con la hora y el autor del servidor", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query(
        `update public.configuracion_plataforma
         set otp_canales_habilitados = '{correo,whatsapp}'`,
      );
      const r = await c.query<{ por: string | null }>(
        `select actualizado_por as por from public.configuracion_plataforma`,
      );
      expect(r.rows[0]?.por).toBe(USUARIOS.admin);
    });
  });

  it("el supervisor NO cambia la política: es cosa de la outsourcing", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const r = await c.query(
        `update public.configuracion_plataforma set otp_canales_habilitados = '{correo,sms}'`,
      );
      expect(r.rowCount).toBe(0);
    });
  });
});

// --- El canje y la elevación a aal2 -------------------------------------------
//
// La Edge Function `canjear-pase` compara el código en tiempo constante y luego
// llama a estas RPC con service_role. Aquí se prueba lo que la base garantiza sola:
// un solo uso bajo concurrencia, el rechazo de usado/revocado/vencido, la cuenta
// de fallos, y que el hook de GoTrue solo sube `aal` a la sesión que canjeó.

const SESION_A = "5e510000-0000-0000-0000-00000000000a";
const SESION_B = "5e510000-0000-0000-0000-00000000000b";

/** Corre algo como la Edge Function: con service_role, en una transacción que se revierte. */
async function comoServicio<T>(
  c: Client,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  await c.query("begin");
  try {
    await c.query("set local role service_role");
    return await fn(c);
  } finally {
    await c.query("rollback");
  }
}

async function canjear(c: Client, paseId: string, sesion: string) {
  const r = await c.query<{ ok: boolean }>(
    "select public.canjear_pase($1, $2) as ok",
    [paseId, sesion],
  );
  return r.rows[0]?.ok;
}

async function estadoDe(c: Client, paseId: string) {
  const r = await c.query<{ estado: string; sesion: string | null }>(
    `select app.estado_pase(usado_at, revocado_at, expira_at)::text as estado,
            usado_por_sesion::text as sesion
     from public.pase_acceso_temporal where id = $1`,
    [paseId],
  );
  return r.rows[0];
}

/** El evento que GoTrue le pasa al hook, con las claims mínimas que importan aquí. */
function eventoDeToken(sesion: string | null, aal = "aal1") {
  return {
    user_id: JOSE,
    authentication_method: "password",
    claims: {
      sub: JOSE,
      role: "authenticated",
      aal,
      session_id: sesion,
      amr: [{ method: "password", timestamp: 1_700_000_000 }],
    },
  };
}

/**
 * Invoca el hook con el evento que le pasaría GoTrue. Corre como `postgres`
 * porque el rol de la conexión no es miembro de `supabase_auth_admin`; que ese
 * rol —y solo ese— tenga el `execute` se comprueba aparte, por privilegio.
 */
async function hook(c: Client, evento: unknown) {
  await c.query("reset role");
  const r = await c.query<{
    salida: { claims: { aal: string; amr: { method: string }[] } };
  }>("select public.custom_access_token_hook($1::jsonb) as salida", [
    JSON.stringify(evento),
  ]);
  return r.rows[0]!.salida;
}

describe("canjear_pase — un solo uso", () => {
  it("marca un pase vigente como usado por la sesión, y solo la primera vez", async () => {
    await comoServicio(db, async (c) => {
      await sembrarPase(c, { id: "e0000019-0000-0000-0000-00000000f001" });
      await c.query("set local role service_role");

      expect(
        await canjear(c, "e0000019-0000-0000-0000-00000000f001", SESION_A),
      ).toBe(true);
      expect(await estadoDe(c, "e0000019-0000-0000-0000-00000000f001")).toEqual(
        { estado: "usado", sesion: SESION_A },
      );

      // Segundo canje del mismo pase, aunque sea desde otra sesión: nada.
      expect(
        await canjear(c, "e0000019-0000-0000-0000-00000000f001", SESION_B),
      ).toBe(false);
      expect(
        (await estadoDe(c, "e0000019-0000-0000-0000-00000000f001"))?.sesion,
      ).toBe(SESION_A);
    });
  });

  it("rechaza un pase usado, uno revocado y uno vencido", async () => {
    await comoServicio(db, async (c) => {
      await sembrarPase(c, {
        id: "e0000019-0000-0000-0000-00000000f002",
        usadoAt: "now()",
      });
      await sembrarPase(c, {
        id: "e0000019-0000-0000-0000-00000000f003",
        revocadoAt: "now()",
      });
      await sembrarPase(c, {
        id: "e0000019-0000-0000-0000-00000000f004",
        generadoAt: "2026-01-01T10:00:00Z",
        expiraAt: "2026-01-01T10:15:00Z",
      });
      await c.query("set local role service_role");

      for (const id of [
        "e0000019-0000-0000-0000-00000000f002",
        "e0000019-0000-0000-0000-00000000f003",
        "e0000019-0000-0000-0000-00000000f004",
      ]) {
        expect(await canjear(c, id, SESION_A)).toBe(false);
      }
      // El vencido sigue sin sesión: no se le pegó ninguna marca de uso.
      expect(
        (await estadoDe(c, "e0000019-0000-0000-0000-00000000f004"))?.sesion,
      ).toBeNull();
    });
  });

  it("los candidatos al canje son SOLO los pases vigentes del propio llamante", async () => {
    // Es la consulta que emite la Edge Function antes de comparar el hash: si un
    // día perdiera el filtro por `profile_id`, un mercaderista podría canjear el
    // pase de otro cuyo código coincidiera. Se siembra un pase de un rival con el
    // MISMO hash y se comprueba que no entra en la lista.
    await comoServicio(db, async (c) => {
      await sembrarPase(c, {
        id: "e0000019-0000-0000-0000-00000000f007",
        codigoHash: "mismo-hash",
      });
      await sembrarPase(c, {
        id: "e0000019-0000-0000-0000-00000000f008",
        profileId: USUARIOS.mercaderistaRival,
        codigoHash: "mismo-hash",
      });
      await sembrarPase(c, {
        id: "e0000019-0000-0000-0000-00000000f009",
        codigoHash: "mismo-hash",
        usadoAt: "now()",
      });
      await c.query("set local role service_role");

      const r = await c.query<{ id: string }>(
        `select id from public.pase_acceso_temporal
         where profile_id = $1 and usado_at is null and revocado_at is null
           and expira_at > now() and codigo_hash = 'mismo-hash'`,
        [JOSE],
      );
      expect(r.rows.map((f) => f.id)).toEqual([
        "e0000019-0000-0000-0000-00000000f007",
      ]);
    });
  });

  it("un pase que no existe devuelve false, no error", async () => {
    await comoServicio(db, async (c) => {
      expect(
        await canjear(c, "e0000019-0000-0000-0000-00000000f0ff", SESION_A),
      ).toBe(false);
    });
  });

  it("bajo concurrencia, de dos canjes del mismo pase solo uno gana", async () => {
    // Dos conexiones de verdad sobre una fila COMMITEADA: la única forma de que
    // el segundo UPDATE espere el candado del primero y re-evalúe el predicado.
    // Por eso este test limpia a mano en vez de apoyarse en el rollback.
    const paseId = "e0000019-0000-0000-0000-00000000f005";
    const otra = await conectar();
    try {
      await db.query(
        `insert into public.pase_acceso_temporal
           (id, profile_id, codigo_hash, motivo, generado_por)
         values ($1, $2, 'hash-de-prueba', 'concurrencia', $3)`,
        [paseId, JOSE, USUARIOS.supervisor],
      );

      const [a, b] = await Promise.all([
        canjear(db, paseId, SESION_A),
        canjear(otra, paseId, SESION_B),
      ]);
      expect([a, b].filter(Boolean)).toHaveLength(1);

      const fila = await estadoDe(db, paseId);
      expect(fila?.estado).toBe("usado");
      expect(fila?.sesion).toBe(a ? SESION_A : SESION_B);
    } finally {
      await db.query("delete from public.pase_acceso_temporal where id = $1", [
        paseId,
      ]);
      await otra.end();
    }
  });

  it("un pase usado siempre dice qué sesión lo usó", async () => {
    // Es lo que consulta el hook y lo que la auditoría necesita: la base no deja
    // marcar `usado_at` a secas.
    await comoServicio(db, async (c) => {
      await sembrarPase(c, { id: "e0000019-0000-0000-0000-00000000f006" });
      // Ni siquiera el dueño de la base se lo salta: es un CHECK, no un grant.
      await c.query("set local role postgres");
      expect(
        await alIntentar(
          c,
          `update public.pase_acceso_temporal set usado_at = now() where id = $1`,
          ["e0000019-0000-0000-0000-00000000f006"],
        ),
      ).toMatch(/pase_uso_con_sesion/i);
    });
  });
});

describe("pase_intento_fallido — la fuerza bruta se agota", () => {
  it("cuenta el fallo sobre los pases vigentes del usuario y al quinto los revoca", async () => {
    await comoServicio(db, async (c) => {
      await sembrarPase(c, { id: "e0000019-0000-0000-0000-00000000f101" });
      await sembrarPase(c, { id: "e0000019-0000-0000-0000-00000000f102" });
      // Uno de OTRO mercaderista: los fallos de José no lo tocan.
      await sembrarPase(c, {
        id: "e0000019-0000-0000-0000-00000000f103",
        profileId: USUARIOS.mercaderistaRival,
      });
      await c.query("set local role service_role");

      for (let i = 1; i <= 4; i++) {
        const r = await c.query<{ quemados: number }>(
          "select public.pase_intento_fallido($1) as quemados",
          [JOSE],
        );
        expect(r.rows[0]?.quemados).toBe(0);
      }
      expect(
        (await estadoDe(c, "e0000019-0000-0000-0000-00000000f101"))?.estado,
      ).toBe("vigente");

      const quinto = await c.query<{ quemados: number }>(
        "select public.pase_intento_fallido($1) as quemados",
        [JOSE],
      );
      expect(quinto.rows[0]?.quemados).toBe(2);
      expect(
        (await estadoDe(c, "e0000019-0000-0000-0000-00000000f101"))?.estado,
      ).toBe("revocado");
      expect(
        (await estadoDe(c, "e0000019-0000-0000-0000-00000000f102"))?.estado,
      ).toBe("revocado");
      expect(
        (await estadoDe(c, "e0000019-0000-0000-0000-00000000f103"))?.estado,
      ).toBe("vigente");

      // Quemado, ya no se canjea aunque el código fuera el bueno.
      expect(
        await canjear(c, "e0000019-0000-0000-0000-00000000f101", SESION_A),
      ).toBe(false);
    });
  });
});

describe("custom_access_token_hook — la única autoridad de aal fuera del OTP", () => {
  it("sube a aal2 la sesión que canjeó un pase y lo deja dicho en amr", async () => {
    await comoServicio(db, async (c) => {
      await sembrarPase(c, {
        id: "e0000019-0000-0000-0000-00000000f201",
        usadoAt: "now()",
        usadoPorSesion: SESION_A,
      });
      const salida = await hook(c, eventoDeToken(SESION_A));
      expect(salida.claims.aal).toBe("aal2");
      expect(salida.claims.amr.map((m) => m.method)).toEqual([
        "password",
        "pase_acceso",
      ]);
    });
  });

  it("otra sesión del mismo usuario se queda en aal1: la elevación es de la sesión", async () => {
    await comoServicio(db, async (c) => {
      await sembrarPase(c, {
        id: "e0000019-0000-0000-0000-00000000f202",
        usadoAt: "now()",
        usadoPorSesion: SESION_A,
      });
      const evento = eventoDeToken(SESION_B);
      expect(await hook(c, evento)).toEqual(evento);
    });
  });

  it("nunca degrada un aal2 nativo ni toca un evento sin sesión legible", async () => {
    await comoServicio(db, async (c) => {
      const nativo = eventoDeToken(SESION_B, "aal2");
      expect(await hook(c, nativo)).toEqual(nativo);

      const sinSesion = eventoDeToken(null);
      expect(await hook(c, sinSesion)).toEqual(sinSesion);

      const rota = eventoDeToken("esto-no-es-un-uuid");
      expect(await hook(c, rota)).toEqual(rota);
    });
  });

  it("solo GoTrue ejecuta el hook y solo el servidor canjea", async () => {
    const r = await db.query<{
      hook_auth: boolean;
      hook_anon: boolean;
      hook_servicio: boolean;
      hook_gotrue: boolean;
      canje_auth: boolean;
      canje_anon: boolean;
      canje_servicio: boolean;
      fallo_auth: boolean;
      fallo_anon: boolean;
      fallo_servicio: boolean;
    }>(`
      select
        has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'execute') as hook_auth,
        has_function_privilege('anon', 'public.custom_access_token_hook(jsonb)', 'execute') as hook_anon,
        has_function_privilege('service_role', 'public.custom_access_token_hook(jsonb)', 'execute') as hook_servicio,
        has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'execute') as hook_gotrue,
        has_function_privilege('authenticated', 'public.canjear_pase(uuid, uuid)', 'execute') as canje_auth,
        has_function_privilege('anon', 'public.canjear_pase(uuid, uuid)', 'execute') as canje_anon,
        has_function_privilege('service_role', 'public.canjear_pase(uuid, uuid)', 'execute') as canje_servicio,
        has_function_privilege('authenticated', 'public.pase_intento_fallido(uuid)', 'execute') as fallo_auth,
        has_function_privilege('anon', 'public.pase_intento_fallido(uuid)', 'execute') as fallo_anon,
        has_function_privilege('service_role', 'public.pase_intento_fallido(uuid)', 'execute') as fallo_servicio
    `);
    expect(r.rows[0]).toEqual({
      hook_auth: false,
      hook_anon: false,
      hook_servicio: false,
      hook_gotrue: true,
      canje_auth: false,
      canje_anon: false,
      canje_servicio: true,
      fallo_auth: false,
      fallo_anon: false,
      fallo_servicio: true,
    });
  });

  it("un mercaderista no se canjea un pase por PostgREST", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      expect(
        await alIntentar(c, "select public.canjear_pase($1, $2)", [
          "e0000019-0000-0000-0000-00000000f001",
          SESION_A,
        ]),
      ).toMatch(/permission denied/i);
    });
  });
});
