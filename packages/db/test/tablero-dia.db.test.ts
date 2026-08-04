import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// El tablero del día del supervisor. Los campos derivados (duración, conteo de
// fotos, motivo de la contingencia) los calcula la base una sola vez, así que se
// prueban contra la base y no contra el helper de TypeScript que los pinta.
//
// El seed deja una visita por cliente, con foto y contingencia, abiertas hoy.

const VISITA_MARACUMANGO = "a0000010-0000-0000-0000-000000000001";
const PARADA = "a0000009-0000-0000-0000-000000000001";
const TIENDA = "a0000002-0000-0000-0000-000000000001";

type FilaTablero = {
  visita_id: string;
  mercaderista_nombre: string;
  mercaderista_dni: string | null;
  tienda_nombre: string;
  duracion_min: number;
  fotos: string;
  estado: string;
  motivo: string | null;
};

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

/** El día de calendario en Lima, que es el "hoy" del negocio. */
async function hoyEnLima(c: Client): Promise<string> {
  const r = await c.query<{ dia: string }>(
    `select to_char((now() at time zone 'America/Lima')::date, 'YYYY-MM-DD') as dia`,
  );
  return r.rows[0]?.dia ?? "";
}

async function tablero(c: Client, fecha: string): Promise<FilaTablero[]> {
  const r = await c.query<FilaTablero>(
    `select * from public.tablero_dia($1::date)`,
    [fecha],
  );
  return r.rows;
}

describe("tablero_dia", () => {
  it("el supervisor ve las visitas de todos los clientes", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const filas = await tablero(c, await hoyEnLima(c));
      expect(filas.length).toBe(2);
    });
  });

  it("el cliente no ve el tablero: lleva datos personales del mercaderista", async () => {
    // No es un filtro por tenant: son CERO filas. El tablero une con `profile`
    // para dar nombre y DNI, y no existe política que deje a un cliente leer esa
    // tabla — a propósito, porque el brand manager es una parte externa y la RLS
    // filtra filas, no columnas. Si alguien añadiera esa política "inofensiva",
    // este test se cae.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      expect(await tablero(c, await hoyEnLima(c))).toEqual([]);
    });
  });

  it("el mercaderista solo se ve a sí mismo, nunca a un compañero", async () => {
    // No queda a cero como el cliente: `profile_lee_el_suyo` le deja su propia
    // fila, así que ve su visita con su propio nombre. Lo que importa es que no
    // alcanza al resto del equipo — el DNI del compañero sigue fuera.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const filas = await tablero(c, await hoyEnLima(c));
      expect(filas.map((f) => f.visita_id)).toEqual([VISITA_MARACUMANGO]);
    });
  });

  it("trae el mercaderista con su DNI y el punto de venta", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const filas = await tablero(c, await hoyEnLima(c));
      const fila = filas.find((f) => f.visita_id === VISITA_MARACUMANGO);
      expect(fila?.mercaderista_nombre).toBeTruthy();
      expect(fila?.mercaderista_dni).toBeTruthy();
      expect(fila?.tienda_nombre).toBeTruthy();
    });
  });

  it("cuenta las fotos de la visita", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const antes = await tablero(c, await hoyEnLima(c));
      const laVisita = (filas: FilaTablero[]) =>
        filas.find((f) => f.visita_id === VISITA_MARACUMANGO);
      expect(Number(laVisita(antes)?.fotos)).toBe(1);

      await c.query("set local role postgres");
      await c.query(
        `insert into public.foto (tenant_id, visita_id, tipo, capturada_at)
         values ($1, $2, 'despues', now())`,
        [TENANTS.maracumango, VISITA_MARACUMANGO],
      );
      await c.query("set local role authenticated");

      const despues = await tablero(c, await hoyEnLima(c));
      expect(Number(laVisita(despues)?.fotos)).toBe(2);
    });
  });

  it("trae el motivo de la contingencia más reciente de la visita", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const laVisita = (filas: FilaTablero[]) =>
        filas.find((f) => f.visita_id === VISITA_MARACUMANGO);
      expect(laVisita(await tablero(c, await hoyEnLima(c)))?.motivo).toBe(
        "Góndola en remodelación, no se pudo verificar precio",
      );

      await c.query("set local role postgres");
      await c.query(
        `insert into public.contingencia
           (tenant_id, visita_id, paso, motivo, registrada_at)
         values ($1, $2, 'exhibiciones', 'Pasillo cerrado por inventario', now() + interval '1 minute')`,
        [TENANTS.maracumango, VISITA_MARACUMANGO],
      );
      await c.query("set local role authenticated");

      expect(laVisita(await tablero(c, await hoyEnLima(c)))?.motivo).toBe(
        "Pasillo cerrado por inventario",
      );
    });
  });

  it("la visita sin contingencia no trae motivo", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await c.query("set local role postgres");
      const nueva = await c.query<{ id: string }>(
        `insert into public.visita
           (tenant_id, rutero_parada_id, mercaderista_id, tienda_id)
         values ($1, $2, $3, $4) returning id`,
        [
          TENANTS.maracumango,
          PARADA,
          USUARIOS.mercaderistaMaracumango,
          TIENDA,
        ],
      );
      await c.query("set local role authenticated");

      const filas = await tablero(c, await hoyEnLima(c));
      const fila = filas.find((f) => f.visita_id === nueva.rows[0]?.id);
      expect(fila?.motivo).toBeNull();
      expect(Number(fila?.fotos)).toBe(0);
    });
  });

  it("la visita en curso mide la duración contra ahora; la cerrada, contra su cierre", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await c.query("set local role postgres");
      await c.query(
        `update public.visita
         set check_in_at = now() - interval '90 minutes' where id = $1`,
        [VISITA_MARACUMANGO],
      );
      await c.query("set local role authenticated");

      const enCurso = await tablero(c, await hoyEnLima(c));
      const abierta = enCurso.find((f) => f.visita_id === VISITA_MARACUMANGO);
      expect(abierta?.estado).toBe("en_curso");
      expect(abierta?.duracion_min).toBe(90);

      await c.query("set local role postgres");
      await c.query(
        `update public.visita
         set check_out_at = check_in_at + interval '25 minutes',
             estado = 'completada'
         where id = $1`,
        [VISITA_MARACUMANGO],
      );
      await c.query("set local role authenticated");

      const cerrada = await tablero(c, await hoyEnLima(c));
      const fila = cerrada.find((f) => f.visita_id === VISITA_MARACUMANGO);
      expect(fila?.duracion_min).toBe(25);
    });
  });

  it("una fecha sin visitas devuelve el tablero vacío", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      expect(await tablero(c, "2020-01-01")).toEqual([]);
    });
  });

  it("la visita de las 20:00 de Lima cuenta para HOY, no para mañana", async () => {
    // El turno de cierre de tienda: a las 20:00 de Lima el reloj UTC ya rodó al
    // día siguiente. Si la ventana se anclara en UTC, esta visita desaparecería
    // del tablero del día en que ocurrió.
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const hoy = await hoyEnLima(c);
      await c.query("set local role postgres");
      await c.query(
        `update public.visita
         set check_in_at = ($1::date + time '20:00') at time zone 'America/Lima'
         where id = $2`,
        [hoy, VISITA_MARACUMANGO],
      );
      await c.query("set local role authenticated");

      const filas = await tablero(c, hoy);
      expect(filas.map((f) => f.visita_id)).toContain(VISITA_MARACUMANGO);

      const manana = await c.query<{ d: string }>(
        `select to_char($1::date + 1, 'YYYY-MM-DD') as d`,
        [hoy],
      );
      const delDiaSiguiente = await tablero(c, manana.rows[0]?.d ?? "");
      expect(delDiaSiguiente.map((f) => f.visita_id)).not.toContain(
        VISITA_MARACUMANGO,
      );
    });
  });
});

describe("tablero_contingencias", () => {
  type FilaContingencia = {
    id: string;
    paso: string;
    motivo: string;
    estado: string;
    tienda_nombre: string;
    mercaderista_nombre: string;
  };

  async function contingencias(
    c: Client,
    fecha: string,
  ): Promise<FilaContingencia[]> {
    const r = await c.query<FilaContingencia>(
      `select * from public.tablero_contingencias($1::date)`,
      [fecha],
    );
    return r.rows;
  }

  it("saca el paso y el motivo del payload que grabó el motor de alertas", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const filas = await contingencias(c, await hoyEnLima(c));
      const suya = filas.find(
        (f) => f.motivo === "Góndola en remodelación, no se pudo verificar precio",
      );
      expect(suya).toMatchObject({ paso: "precios", estado: "nueva" });
      expect(suya?.tienda_nombre).toBeTruthy();
      expect(suya?.mercaderista_nombre).toBeTruthy();
    });
  });

  it("el supervisor ve las contingencias de todos los clientes", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      expect(await contingencias(c, await hoyEnLima(c))).toHaveLength(2);
    });
  });

  it("el cliente no ve el feed: nombra al mercaderista", async () => {
    // Mismo motivo que en `tablero_dia`: el join a `profile` deja fuera a quien
    // no es staff. El feed de contingencias es del supervisor.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      expect(await contingencias(c, await hoyEnLima(c))).toEqual([]);
    });
  });

  it("no cuela alertas que no son de contingencia", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const filas = await contingencias(c, await hoyEnLima(c));
      // El seed también deja alertas de `quiebre` sobre las mismas visitas.
      expect(filas.every((f) => f.paso !== null)).toBe(true);
      expect(filas).toHaveLength(2);
    });
  });
});
