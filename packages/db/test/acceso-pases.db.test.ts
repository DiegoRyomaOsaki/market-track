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
  },
): Promise<void> {
  await c.query("set local role postgres");
  await c.query(
    `insert into public.pase_acceso_temporal
       (id, profile_id, codigo_hash, motivo, generado_por,
        generado_at, expira_at, usado_at, revocado_at)
     values ($1, $2, 'hash-de-prueba', $3, $4,
             coalesce($5::timestamptz, now()),
             coalesce($6::timestamptz, now() + interval '15 minutes'),
             $7::timestamptz, $8::timestamptz)`,
    [
      p.id,
      p.profileId ?? JOSE,
      p.motivo ?? "No le llega el OTP",
      p.generadoPor ?? USUARIOS.supervisor,
      p.generadoAt ?? null,
      p.expiraAt ?? null,
      p.usadoAt ?? null,
      p.revocadoAt ?? null,
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
