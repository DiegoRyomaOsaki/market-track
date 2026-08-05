import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// La galería de evidencia del portal. Lo que ve el cliente-marca y —sobre todo—
// lo que NO ve: ni la evidencia de otro cliente, ni la cara de un mercaderista.

const VISITA_MRC = "a0000010-0000-0000-0000-000000000001";
const LEVANTAMIENTO_MRC = "a0000011-0000-0000-0000-000000000001";
const TIENDA_MRC = "a0000002-0000-0000-0000-000000000001";
const CADENA_MRC = "a0000001-0000-0000-0000-000000000001";

const TODO = ["2020-01-01", "2030-01-01"] as const;

type Arbol = {
  visitas_totales: number;
  truncado: boolean;
  tiendas: {
    id: string;
    nombre: string;
    cadena_nombre: string;
    visitas: {
      id: string;
      fotos_visita: { tipo: string }[];
      levantamientos: {
        id: string;
        marca_nombre: string;
        quiebres: number;
        antes: { id: string; subida_at: string | null } | null;
        despues: { id: string; subida_at: string | null } | null;
        otras: { tipo: string }[];
      }[];
    }[];
  }[];
};

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

async function galeria(
  c: Client,
  args: {
    desde?: string;
    hasta?: string;
    cadena?: string | null;
    tienda?: string | null;
    tipo?: string | null;
    tope?: number;
  } = {},
): Promise<Arbol> {
  const r = await c.query<{ g: Arbol }>(
    `select public.galeria_evidencia($1::date, $2::date, $3, $4, $5::public.tipo_foto, $6) as g`,
    [
      args.desde ?? TODO[0],
      args.hasta ?? TODO[1],
      args.cadena ?? null,
      args.tienda ?? null,
      args.tipo ?? null,
      args.tope ?? 24,
    ],
  );
  return r.rows[0]!.g;
}

/** Todas las fotos del árbol, aplanadas, para afirmar sobre el conjunto. */
function todasLasFotos(a: Arbol): { tipo: string }[] {
  return a.tiendas.flatMap((t) =>
    t.visitas.flatMap((v) => [
      ...v.fotos_visita,
      ...v.levantamientos.flatMap((l) => l.otras),
    ]),
  );
}

describe("galeria_evidencia — qué ve el cliente-marca", () => {
  it("ve la evidencia de SU cliente y ninguna del rival", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      const a = await galeria(c);
      expect(a.tiendas.length).toBeGreaterThan(0);
      expect(a.tiendas.map((t) => t.id)).toEqual([TIENDA_MRC]);
    });
  });

  it("el mercaderista tampoco ve más allá de su cliente", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const a = await galeria(c);
      expect(a.tiendas.every((t) => t.id === TIENDA_MRC)).toBe(true);
    });
  });

  it("la SELFIE nunca sale, ni pidiéndola por su tipo", async () => {
    // Es la cara de un empleado de la outsourcing, no evidencia de tienda. El
    // guardián es el SQL: que el desplegable no la ofrezca no protege nada.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      expect(todasLasFotos(await galeria(c)).map((f) => f.tipo)).not.toContain(
        "selfie",
      );

      const pidiendola = await galeria(c, { tipo: "selfie" });
      expect(todasLasFotos(pidiendola)).toEqual([]);
      expect(
        pidiendola.tiendas.flatMap((t) =>
          t.visitas.flatMap((v) => v.levantamientos.map((l) => l.antes)),
        ),
      ).toEqual([null]);
    });
  });
});

describe("galeria_evidencia — el par antes/después", () => {
  it("sale de `foto.tipo` + `levantamiento_id`, agrupado por marca", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      const a = await galeria(c);
      const lev = a.tiendas[0]?.visitas[0]?.levantamientos[0];
      expect(lev?.marca_nombre).toBeTruthy();
      expect(lev?.antes?.id).toBeTruthy();
      expect(lev?.despues?.id).toBeTruthy();
    });
  });

  it("IGNORA `levantamiento.foto_antes_id`: esa columna está muerta", async () => {
    // El móvil la deja en null a propósito. Si la galería la leyera, el par
    // dependería de un camino que nadie escribe.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await c.query("set local role postgres");
      // Se apunta la FK a la foto de "después": si la función la leyera, el
      // "antes" saldría con el id equivocado.
      await c.query(
        `update public.levantamiento set foto_antes_id = $2 where id = $1`,
        [LEVANTAMIENTO_MRC, "a0000015-0000-0000-0000-000000000003"],
      );
      await c.query("set local role authenticated");

      const lev = (await galeria(c)).tiendas[0]?.visitas[0]?.levantamientos[0];
      expect(lev?.antes?.id).toBe("a0000015-0000-0000-0000-000000000001");
    });
  });

  it("con dos fotos del mismo tipo gana la más reciente, de forma determinista", async () => {
    // El móvil inserta una fila por pulsación y nada deduplica. Sin un orden
    // explícito, el comparador enseñaría una foto distinta en cada refresco.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await c.query("set local role postgres");
      await c.query(
        `insert into public.foto (id, tenant_id, visita_id, levantamiento_id, tipo, capturada_at)
         values ($1, $2, $3, $4, 'antes', now() + interval '1 hour')`,
        [
          "e0000015-0000-0000-0000-000000000099",
          TENANTS.maracumango,
          VISITA_MRC,
          LEVANTAMIENTO_MRC,
        ],
      );
      await c.query("set local role authenticated");

      const primera = await galeria(c);
      const segunda = await galeria(c);
      const idDe = (a: Arbol) =>
        a.tiendas[0]?.visitas[0]?.levantamientos[0]?.antes?.id;

      expect(idDe(primera)).toBe("e0000015-0000-0000-0000-000000000099");
      expect(idDe(segunda)).toBe(idDe(primera));
    });
  });

  it("una foto sin subir sale igual, con `subida_at` en null", async () => {
    // La galería tiene que poder decir "sigue en el teléfono" en vez de un hueco.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      const lev = (await galeria(c)).tiendas[0]?.visitas[0]?.levantamientos[0];
      expect(lev?.antes?.subida_at).toBeNull();
    });
  });
});

describe("galeria_evidencia — filtros", () => {
  it("filtra por cadena", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      expect((await galeria(c, { cadena: CADENA_MRC })).tiendas).toHaveLength(
        1,
      );
      expect(
        (await galeria(c, { cadena: "aaaa0000-0000-0000-0000-00000000ffff" }))
          .tiendas,
      ).toEqual([]);
    });
  });

  it("filtra por tienda", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      expect((await galeria(c, { tienda: TIENDA_MRC })).tiendas).toHaveLength(
        1,
      );
      expect(
        (await galeria(c, { tienda: "aaaa0000-0000-0000-0000-00000000ffff" }))
          .tiendas,
      ).toEqual([]);
    });
  });

  it("filtra por tipo: apaga la ranura del par que no encaja", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      const soloAntes = await galeria(c, { tipo: "antes" });
      const lev = soloAntes.tiendas[0]?.visitas[0]?.levantamientos[0];
      expect(lev?.antes?.id).toBeTruthy();
      expect(lev?.despues).toBeNull();
    });
  });

  it("la ventana es el día de LIMA, no el de UTC", async () => {
    // 20:00 de Lima ya es el día siguiente en UTC. Si la ventana se resolviera en
    // UTC, la visita no saldría al pedir su propio día.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await c.query("set local role postgres");
      await c.query(
        `update public.visita set check_in_at = timestamptz '2026-03-10 20:00:00-05' where id = $1`,
        [VISITA_MRC],
      );
      await c.query("set local role authenticated");

      const suDia = await galeria(c, {
        desde: "2026-03-10",
        hasta: "2026-03-10",
      });
      const elSiguiente = await galeria(c, {
        desde: "2026-03-11",
        hasta: "2026-03-11",
      });

      expect(suDia.tiendas).toHaveLength(1);
      expect(elSiguiente.tiendas).toEqual([]);
    });
  });
});

describe("galeria_evidencia — cotas y forma", () => {
  it("sin visitas en la ventana devuelve el árbol vacío, no null", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      const a = await galeria(c, { desde: "2019-01-01", hasta: "2019-01-31" });
      expect(a.tiendas).toEqual([]);
      expect(a.truncado).toBe(false);
      expect(a.visitas_totales).toBe(0);
    });
  });

  it("el tope trunca y lo DICE, en vez de callarlo", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      const a = await galeria(c, { tope: 0 });
      expect(a.tiendas).toEqual([]);
      expect(a.truncado).toBe(true);
      expect(a.visitas_totales).toBeGreaterThan(0);
    });
  });

  it("devuelve EXACTAMENTE las claves que espera el schema Zod", async () => {
    // `galeriaEvidenciaSchema` (packages/shared) y esta función son un contrato
    // entre dos archivos que nadie compila juntos. `packages/db` no puede
    // importar `packages/shared` —sería un ciclo—, así que el espejo vive aquí:
    // al tocar el schema hay que tocar esta lista.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      const a = (await galeria(c)) as unknown as Record<string, unknown>;
      expect(Object.keys(a).sort()).toEqual([
        "tiendas",
        "truncado",
        "visitas_totales",
      ]);

      const tienda = (a.tiendas as Record<string, unknown>[])[0]!;
      expect(Object.keys(tienda).sort()).toEqual([
        "cadena_nombre",
        "direccion",
        "id",
        "nombre",
        "visitas",
      ]);

      const visita = (tienda.visitas as Record<string, unknown>[])[0]!;
      expect(Object.keys(visita).sort()).toEqual([
        "check_in_at",
        "check_out_at",
        "fotos_visita",
        "id",
        "levantamientos",
      ]);

      const lev = (visita.levantamientos as Record<string, unknown>[])[0]!;
      expect(Object.keys(lev).sort()).toEqual([
        "antes",
        "despues",
        "estado",
        "id",
        "marca_nombre",
        "otras",
        "quiebres",
        "sos_frentes_propios",
      ]);

      expect(Object.keys(lev.antes as Record<string, unknown>).sort()).toEqual([
        "capturada_at",
        "id",
        "subida_at",
      ]);
    });
  });
});
