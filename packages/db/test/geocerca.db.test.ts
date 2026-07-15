import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, USUARIOS } from "./ayudas";

// El trigger de revalidación de geocerca (server-side). La geocerca del teléfono
// es UX; esto es la seguridad: recalcula la distancia con PostGIS y sella la hora
// de recepción, que el teléfono NO puede falsear. No bloquea el sync: marca.
//
// Tienda del seed a0000002: POINT(-76.94 -12.08), radio 100 m.

const RUTERO_PARADA = "a0000009-0000-0000-0000-000000000001";
const TIENDA = "a0000002-0000-0000-0000-000000000001";
const DENTRO = "SRID=4326;POINT(-76.94 -12.08)"; // el punto exacto de la tienda
const FUERA = "SRID=4326;POINT(-76.95 -12.09)"; // ~1,5 km: muy fuera de los 100 m

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

/** Inserta una visita como el mercaderista y devuelve la fila resultante. */
async function insertarVisita(
  c: Client,
  geoWkt: string | null,
  recibidoForjado?: string,
) {
  const id = "e0000010-0000-0000-0000-000000000030";
  const cols = [
    "id",
    "rutero_parada_id",
    "mercaderista_id",
    "tienda_id",
    "estado",
    "check_in_at",
    "check_in_geo",
  ];
  const vals = [
    "$1",
    "$2",
    "$3",
    "$4",
    "'en_curso'",
    "now()",
    geoWkt ? "$5::extensions.geography" : "null",
  ];
  const params: unknown[] = [
    id,
    RUTERO_PARADA,
    USUARIOS.mercaderistaMaracumango,
    TIENDA,
  ];
  if (geoWkt) params.push(geoWkt);
  if (recibidoForjado) {
    cols.push("check_in_recibido_at");
    vals.push(`$${params.length + 1}`);
    params.push(recibidoForjado);
  }
  await c.query(
    `insert into public.visita (${cols.join(", ")}) values (${vals.join(", ")})`,
    params,
  );
  const r = await c.query<{
    check_in_geocerca_ok: boolean | null;
    check_in_recibido_at: string;
  }>(
    "select check_in_geocerca_ok, check_in_recibido_at from public.visita where id = $1",
    [id],
  );
  return r.rows[0];
}

describe("revalidación de geocerca en servidor", () => {
  it("marca DENTRO cuando la coordenada cae en el radio de la tienda", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const fila = await insertarVisita(c, DENTRO);
      expect(fila?.check_in_geocerca_ok).toBe(true);
    });
  });

  it("marca FUERA cuando la coordenada está lejos de la tienda", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const fila = await insertarVisita(c, FUERA);
      expect(fila?.check_in_geocerca_ok).toBe(false);
    });
  });

  it("deja NULL (no validado) cuando no hay coordenada", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const fila = await insertarVisita(c, null);
      expect(fila?.check_in_geocerca_ok).toBeNull();
    });
  });
});

describe("timestamp de servidor — el teléfono no lo decide", () => {
  it("sobrescribe un check_in_recibido_at forjado por el cliente con la hora real", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      // El cliente intenta sellar una recepción en el año 2000.
      const fila = await insertarVisita(c, DENTRO, "2000-01-01T00:00:00Z");
      const recibido = new Date(fila!.check_in_recibido_at).getTime();
      const hace1min = Date.now() - 60_000;
      // El trigger lo reescribió a ~ahora, no al 2000.
      expect(recibido).toBeGreaterThan(hace1min);
    });
  });
});
