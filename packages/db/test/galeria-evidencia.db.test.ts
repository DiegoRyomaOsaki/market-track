import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// La galería de evidencia del portal. Lo que ve el cliente-marca y —sobre todo—
// lo que NO ve: ni la evidencia de otro cliente, ni la cara de un mercaderista.

const VISITA_MRC = "a0000010-0000-0000-0000-000000000001";
const LEVANTAMIENTO_MRC = "a0000011-0000-0000-0000-000000000001";
const TIENDA_MRC = "a0000002-0000-0000-0000-000000000001";
const CADENA_MRC = "a0000001-0000-0000-0000-000000000001";

// Los del cliente RIVAL. Existen de verdad: un id inventado prueba "no existe",
// no "es de otro cliente", que es la superficie que importa.
const TIENDA_RIVAL = "b0000002-0000-0000-0000-000000000002";
const CADENA_RIVAL = "b0000001-0000-0000-0000-000000000002";

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

describe("galeria_evidencia — la foto de un campo configurable (campo_extra)", () => {
  // El enum creció sin tocar el SQL de la galería: su cubeta `otras` es
  // `tipo not in ('selfie','antes','despues')`. Derived SQL cuyo comportamiento
  // cambia con el enum → se verifica contra la base sembrada, no contra el tipo.
  const FOTO_CAMPO = "e0000015-0000-0000-0000-000000000097";

  async function sembrarFotoCampo(c: Client): Promise<void> {
    await c.query("set local role postgres");
    await c.query(
      `insert into public.foto (id, tenant_id, visita_id, levantamiento_id, tipo, capturada_at)
       values ($1, $2, $3, $4, 'campo_extra', now())`,
      [FOTO_CAMPO, TENANTS.maracumango, VISITA_MRC, LEVANTAMIENTO_MRC],
    );
    await c.query("set local role authenticated");
  }

  it("sale en la cubeta `otras` de su levantamiento", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await sembrarFotoCampo(c);
      const lev = (await galeria(c)).tiendas[0]?.visitas[0]?.levantamientos[0];
      expect(lev?.otras.map((f) => f.tipo)).toContain("campo_extra");
    });
  });

  it("filtrar por campo_extra la deja sola y apaga el par antes/después", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await sembrarFotoCampo(c);
      const filtrado = await galeria(c, { tipo: "campo_extra" });
      const lev = filtrado.tiendas[0]?.visitas[0]?.levantamientos[0];
      expect(lev?.otras.map((f) => f.tipo)).toEqual(["campo_extra"]);
      expect(lev?.antes).toBeNull();
      expect(lev?.despues).toBeNull();
    });
  });
});

describe("la foto de herramientas del check-in — dato laboral, no evidencia de tienda", () => {
  // `campo_extra` con `levantamiento_id` NULL es la foto del checklist del
  // check-in (MAR-98): botas, casco, metro. Es personal de la outsourcing; el
  // cliente-marca no la ve — mismo criterio y misma política que la selfie. El
  // staff sí: para el supervisor es evidencia de cumplimiento.
  const FOTO_HERRAMIENTAS = "e0000015-0000-0000-0000-000000000096";

  async function sembrarFotoHerramientas(c: Client): Promise<void> {
    await c.query("set local role postgres");
    await c.query(
      `insert into public.foto (id, tenant_id, visita_id, levantamiento_id, tipo, capturada_at)
       values ($1, $2, $3, null, 'campo_extra', now())`,
      [FOTO_HERRAMIENTAS, TENANTS.maracumango, VISITA_MRC],
    );
    await c.query("set local role authenticated");
  }

  it("el cliente-marca NO la ve, ni en la galería ni consultando `foto`", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await sembrarFotoHerramientas(c);
      const directa = await c.query(
        `select id from public.foto where id = $1`,
        [FOTO_HERRAMIENTAS],
      );
      expect(directa.rowCount).toBe(0);

      const arbol = await galeria(c);
      const fotosVisita =
        arbol.tiendas[0]?.visitas[0]?.fotos_visita.map((f) => f.tipo) ?? [];
      expect(fotosVisita).not.toContain("campo_extra");
    });
  });

  it("el supervisor SÍ la ve en `fotos_visita`", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await sembrarFotoHerramientas(c);
      const arbol = await galeria(c);
      const fotosVisita = arbol.tiendas
        .flatMap((t) => t.visitas)
        .flatMap((v) => v.fotos_visita)
        .map((f) => f.tipo);
      expect(fotosVisita).toContain("campo_extra");
    });
  });

  it("la foto campo_extra DE UN LEVANTAMIENTO sigue visible para el cliente", async () => {
    // La exclusión es quirúrgica: solo la del check-in (sin levantamiento). La
    // evidencia de góndola capturada por un campo del wizard es de la tienda y
    // el cliente la compra.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await c.query("set local role postgres");
      await c.query(
        `insert into public.foto (id, tenant_id, visita_id, levantamiento_id, tipo, capturada_at)
         values ($1, $2, $3, $4, 'campo_extra', now())`,
        [
          "e0000015-0000-0000-0000-000000000095",
          TENANTS.maracumango,
          VISITA_MRC,
          LEVANTAMIENTO_MRC,
        ],
      );
      await c.query("set local role authenticated");
      const directa = await c.query(
        `select id from public.foto where id = $1`,
        ["e0000015-0000-0000-0000-000000000095"],
      );
      expect(directa.rowCount).toBe(1);
    });
  });
});

describe("galeria_evidencia — filtros", () => {
  it("pedir la tienda REAL del rival por parámetro no devuelve nada", async () => {
    // Distinto de pasar un uuid inventado: aquí la tienda existe y tiene visitas
    // con fotos. Lo único que la esconde es la RLS. Sin este test, "filtra por
    // tienda" pasaría igual con la RLS desactivada.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      expect((await galeria(c, { tienda: TIENDA_RIVAL })).tiendas).toEqual([]);
      expect((await galeria(c, { cadena: CADENA_RIVAL })).tiendas).toEqual([]);
    });
  });

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

describe("la selfie de check-in — el dato personal del mercaderista", () => {
  it("el cliente-marca NO la lee ni consultando `foto` directamente", async () => {
    // Excluirla en la galería no bastaba: el cliente podía pedir
    // `foto?tipo=eq.selfie` por PostgREST, quedarse con el id y hacérselo firmar
    // por `fotos-url-firmada`, que firma lo que la RLS deje leer. El guardián
    // tiene que ser la política.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      const r = await c.query(
        `select id from public.foto where tipo = 'selfie'`,
      );
      expect(r.rows).toEqual([]);
    });
  });

  it("pero el staff sí la ve: para el supervisor es evidencia de quién fichó", async () => {
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      const r = await c.query(
        `select id from public.foto where tipo = 'selfie'`,
      );
      expect(r.rows.length).toBeGreaterThan(0);
    });
  });

  it("y el mercaderista sigue viendo las suyas: son las que acaba de subir", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const r = await c.query(
        `select id from public.foto where tipo = 'selfie'`,
      );
      expect(r.rows.length).toBeGreaterThan(0);
    });
  });

  it("el resto de la evidencia le sigue llegando al cliente", async () => {
    // El cierre no puede ser un apagón: si la política se pasara de ancha, la
    // galería se quedaría vacía y este test lo dice.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      const r = await c.query(
        `select id from public.foto where tipo <> 'selfie'`,
      );
      expect(r.rows.length).toBeGreaterThan(0);
    });
  });
});
