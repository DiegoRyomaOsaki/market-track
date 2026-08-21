import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// El motor de puntaje de Perfect Store: las tres variables objetivas.
//
// Aquí es donde de verdad se prueba la métrica. El puntaje sale de la base y lo
// consumen el portal, el panel y el teléfono; si la cuenta está mal, los tres
// enseñan el mismo número equivocado y la discusión con la marca pasa a ser sobre
// cuál pantalla tiene razón.
//
// Todo corre dentro de la transacción con rollback de `comoUsuario`.

const IDS = {
  marca: "cccccccc-0000-0000-0000-000000000001",
  tienda: "a0000002-0000-0000-0000-000000000001",
  parada: "a0000009-0000-0000-0000-000000000001",
  sku: "a0000003-0000-0000-0000-000000000001",
  configDefault: "a0000019-0000-0000-0000-000000000001",
  marcaSinConfig: "cccccccc-0000-0000-0000-000000000002",
} as const;

/** El precio regular sembrado del SKU y la cadena de su tienda. La marca tolera
 *  un 5 %, así que el techo del "correcto" está en 7,245. */
const CADENA = "a0000001-0000-0000-0000-000000000001";
const PRECIO_REGULAR = 6.9;

/**
 * Un uuid del arnés: `f000001<bloque>-…` con el sufijo alineado a la derecha.
 *
 * Interpolar sobre el literal de diez ceros exige un sufijo de exactamente dos
 * caracteres; las exhibiciones concatenan el del levantamiento con su índice y
 * miden tres, así que aquí se rellena en vez de interpolar.
 */
function id(bloque: string, sufijo: string): string {
  return `f000001${bloque}-0000-0000-0000-${sufijo.padStart(12, "0")}`;
}

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

/**
 * Cambia a quién se suplanta SIN abrir otra transacción.
 *
 * Hace falta porque un caso realista mezcla dos roles: el maestro (SKUs,
 * codificados, configuración) lo escribe el admin y los datos de campo los
 * escribe el mercaderista, y las políticas de escritura son distintas. Si el
 * test lo hiciera todo con un solo rol, o probaría algo que en producción no
 * pasa, o chocaría con la RLS — que es justo lo que pasó al escribirlo.
 */
async function comoOtro<T>(
  c: Client,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const claims = JSON.stringify({
    sub: userId,
    role: "authenticated",
    aal: "aal2",
  });
  await c.query(`set local request.jwt.claims = '${claims}'`);
  try {
    return await fn();
  } finally {
    const admin = JSON.stringify({
      sub: USUARIOS.admin,
      role: "authenticated",
      aal: "aal2",
    });
    await c.query(`set local request.jwt.claims = '${admin}'`);
  }
}

type Puntaje = {
  distribucion_pct: string | null;
  visibilidad_pct: string | null;
  precio_pct: string | null;
  pop_pct: string | null;
  orden_pct: string | null;
  total_pct: string | null;
  sos_real_pct: string | null;
  skus_codificados: number;
  skus_evaluados: number;
  skus_presentes: number;
  skus_precio_evaluados: number;
  skus_precio_correctos: number;
  config_id: string;
};

/**
 * Monta una visita con su levantamiento y sus SKUs, y lo cierra.
 *
 * Devuelve el puntaje que dejó el disparador, o null si no dejó ninguno — que es
 * un resultado tan válido como un número: significa "no se evaluó".
 */
async function levantarYPuntuar(
  c: Client,
  sufijo: string,
  opciones: {
    marcaId?: string;
    estado?: string;
    sosPropios?: number | null;
    sosCompetencia?: { marca: string; frentes: number }[];
    /** La calificación de orden y limpieza, con su foto obligatoria. */
    orden?: "bien" | "regular" | "mal";
    /**
     * Las exhibiciones auditadas. `negociada` la hace COMPROMETIDA (entra en el
     * denominador); `tipoAdicional` la hace CONSEGUIDA por el mercaderista (suma
     * al numerador y no al denominador).
     *
     * `instalada` y `completa` se dejan sin poner a propósito en varios tests:
     * hoy el móvil no escribe ninguna de las dos, y el motor tiene un coalesce
     * para cada una. Poder sembrar el `undefined` es lo que permite probarlos.
     */
    exhibiciones?: {
      negociada?: string;
      tipoAdicional?: string;
      instalada?: boolean;
      completa?: boolean;
      vigente?: boolean;
    }[];
    skus?: {
      skuId?: string;
      quiebre?: { sistema: number; piso: number };
      precio?: number | null;
      hayPromo?: boolean;
      promoComunicada?: boolean;
    }[];
  } = {},
): Promise<Puntaje | null> {
  const visita = `f0000010-0000-0000-0000-0000000000${sufijo}`;
  const lev = `f0000011-0000-0000-0000-0000000000${sufijo}`;

  await comoOtro(c, USUARIOS.mercaderistaMaracumango, async () => {
    await c.query(
      // El `tenant_id` va EXPLÍCITO: su default es `app.tenant_actual()`, que para
      // el admin es null —es staff de la plataforma, no pertenece a ningún cliente—
      // y la columna es not null.
      `insert into public.visita (id, tenant_id, rutero_parada_id, mercaderista_id, tienda_id, estado, check_in_at)
     values ($1, $2, $3, $4, $5, 'en_curso', now())`,
      [
        visita,
        TENANTS.maracumango,
        IDS.parada,
        USUARIOS.mercaderistaMaracumango,
        IDS.tienda,
      ],
    );
    await c.query(
      `insert into public.levantamiento
       (id, tenant_id, visita_id, marca_id, sos_frentes_propios, sos_frentes_competencia)
     values ($1, $2, $3, $4, $5, $6)`,
      [
        lev,
        TENANTS.maracumango,
        visita,
        opciones.marcaId ?? IDS.marca,
        opciones.sosPropios ?? null,
        JSON.stringify(opciones.sosCompetencia ?? []),
      ],
    );

    let n = 0;
    for (const s of opciones.skus ?? []) {
      n += 1;
      await c.query(
        `insert into public.levantamiento_sku
         (tenant_id, levantamiento_id, sku_id, stock_sistema, stock_piso,
          precio_registrado, hay_promo, promo_comunicada)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          TENANTS.maracumango,
          lev,
          s.skuId ?? IDS.sku,
          s.quiebre?.sistema ?? null,
          s.quiebre?.piso ?? null,
          s.precio ?? null,
          s.hayPromo ?? null,
          s.promoComunicada ?? null,
        ],
      );
      if (n > 50) break;
    }

    let e = 0;
    for (const ex of opciones.exhibiciones ?? []) {
      e += 1;
      await c.query(
        `insert into public.exhibicion
           (id, tenant_id, levantamiento_id, exhibicion_negociada_id,
            tipo_adicional, instalada, completa, vigente)
         values ($1, $2, $3, $4, $5::public.tipo_exhibicion, $6, $7, $8)`,
        [
          id("5", `${sufijo}${e}`),
          TENANTS.maracumango,
          lev,
          ex.negociada ?? null,
          ex.tipoAdicional ?? null,
          ex.instalada ?? null,
          ex.completa ?? null,
          ex.vigente ?? null,
        ],
      );
    }

    if (opciones.orden) {
      await calificarOrden(c, sufijo, lev, visita, opciones.orden);
    }

    await c.query(`update public.levantamiento set estado = $2 where id = $1`, [
      lev,
      opciones.estado ?? "completado",
    ]);
  });

  const r = await c.query<Puntaje>(
    `select distribucion_pct, visibilidad_pct, precio_pct, pop_pct, orden_pct,
            total_pct,
            sos_real_pct,
            skus_codificados, skus_evaluados, skus_presentes,
            skus_precio_evaluados, skus_precio_correctos, config_id
     from public.puntaje_perfect_store where levantamiento_id = $1`,
    [lev],
  );
  return r.rows[0] ?? null;
}

/**
 * El SQLSTATE que deja una sentencia que debe fallar, sin llevarse por delante la
 * transacción del test.
 *
 * El savepoint es obligatorio: una restricción violada ABORTA la transacción, y a
 * partir de ahí toda consulta muere con "current transaction is aborted" —
 * incluida la que restaura el rol al salir del helper. Sin esto, un test que
 * comprueba un CHECK rompe al siguiente.
 */
async function codigoDeError(c: Client, sql: string): Promise<string> {
  await c.query("savepoint intento");
  try {
    await c.query(sql);
    await c.query("release savepoint intento");
    return "";
  } catch (err) {
    await c.query("rollback to savepoint intento");
    return (err as { code?: string }).code ?? "";
  }
}

/**
 * Una exhibición COMPROMETIDA por la marca en la tienda del seed.
 *
 * Se siembra aquí y no se reutiliza la del seed (`a0000007-…`) a propósito: las
 * del seed las comparten otros archivos del arnés, así que apoyarse en ellas
 * ataría estos tests a datos que no controlan.
 *
 * La fecha de inicio esquiva las del seed: la clave natural es
 * `(tenant, tienda, marca, tipo, fecha_inicio)` y el seed ya tiene un jalavista
 * y una activación arrancando el 1 de enero en esta misma tienda.
 */
async function conNegociada(
  c: Client,
  sufijo: string,
  tipo = "cabecera",
): Promise<string> {
  const negociada = id("9", sufijo);
  await c.query("set local role postgres");
  await c.query(
    `insert into public.exhibicion_negociada
       (id, tenant_id, tienda_id, marca_id, tipo, fecha_inicio, fecha_fin)
     values ($1, $2, $3, $4, $5::public.tipo_exhibicion, '2026-02-01', '2026-12-31')`,
    [negociada, TENANTS.maracumango, IDS.tienda, IDS.marca, tipo],
  );
  await c.query("set local role authenticated");
  return negociada;
}

/**
 * Califica el orden del levantamiento, con su foto.
 *
 * La foto PRIMERO y la calificación después, en una sola sentencia: es el orden
 * que el móvil tiene que respetar, porque el CHECK exige las dos juntas. La fila
 * `foto` se escribe al capturar y su binario sube horas después — por eso
 * `subida_at` se queda null aquí, como en el campo de verdad.
 */
async function calificarOrden(
  c: Client,
  sufijo: string,
  levantamiento: string,
  visita: string,
  nivel: string,
): Promise<string> {
  const foto = `f0000014-0000-0000-0000-0000000000${sufijo}`;
  await c.query(
    `insert into public.foto
       (id, tenant_id, visita_id, levantamiento_id, tipo, capturada_at)
     values ($1, $2, $3, $4, 'orden', now())`,
    [foto, TENANTS.maracumango, visita, levantamiento],
  );
  await c.query(
    `update public.levantamiento
        set orden_nivel = $2::public.nivel_orden, orden_foto_id = $3
      where id = $1`,
    [levantamiento, nivel, foto],
  );
  return foto;
}

/**
 * Crea N SKUs codificados en la tienda, además del que ya trae el seed.
 *
 * `conPrecio` siembra además su precio regular. Sin él, esos SKUs salen como
 * `sin_precio_vigente` y NO entran en el denominador del puntaje de precio —
 * correcto, pero inservible para probar una proporción.
 */
async function codificar(
  c: Client,
  cuantos: number,
  conPrecio = false,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < cuantos; i += 1) {
    const id = `f0000003-0000-0000-0000-0000000000${String(i).padStart(2, "0")}`;
    await c.query(
      `insert into public.sku (id, tenant_id, marca_id, codigo, nombre)
       values ($1, $2, $3, $4, $5)`,
      [id, TENANTS.maracumango, IDS.marca, `EXTRA-${i}`, `SKU extra ${i}`],
    );
    await c.query(
      `insert into public.tienda_sku (tenant_id, tienda_id, sku_id)
       values ($1, $2, $3)`,
      [TENANTS.maracumango, IDS.tienda, id],
    );
    if (conPrecio) {
      await c.query(
        `insert into public.precio_regular
           (tenant_id, sku_id, cadena_id, precio, vigente_desde)
         values ($1, $2, $3, $4, '2026-01-01')`,
        [TENANTS.maracumango, id, CADENA, PRECIO_REGULAR],
      );
    }
    ids.push(id);
  }
  return ids;
}

describe("distribución / disponibilidad", () => {
  it("un SKU presente sobre uno codificado da 100", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "01", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      expect(Number(p?.distribucion_pct)).toBe(100);
      expect(p?.skus_presentes).toBe(1);
      expect(p?.skus_evaluados).toBe(1);
    });
  });

  it("un SKU en QUIEBRE no cuenta como presente", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "02", {
        // stock_sistema > 0 y piso 0: eso es un quiebre (columna generada).
        skus: [{ quiebre: { sistema: 5, piso: 0 } }],
      });

      expect(Number(p?.distribucion_pct)).toBe(0);
      expect(p?.skus_presentes).toBe(0);
    });
  });

  it("un SKU codificado que NO se levantó no entra en el denominador", async () => {
    // "Sin dato" no es "ausente": meterlo hundiría el puntaje por una visita
    // incompleta en vez de por una tienda mal ejecutada.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await codificar(c, 3);
      const p = await levantarYPuntuar(c, "03", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      expect(p?.skus_codificados).toBe(4);
      expect(p?.skus_evaluados).toBe(1);
      expect(Number(p?.distribucion_pct)).toBe(100);
    });
  });

  it("sin SKUs codificados la distribución queda SIN EVALUAR, no en cero", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query(
        `update public.tienda_sku set activo = false where tienda_id = $1`,
        [IDS.tienda],
      );
      const p = await levantarYPuntuar(c, "04", {});

      expect(p?.distribucion_pct).toBeNull();
      expect(p?.skus_codificados).toBe(0);
    });
  });
});

describe("visibilidad (share of shelf)", () => {
  it("el real se compara contra el objetivo de la configuración", async () => {
    // El seed configura el objetivo en 35. Con 35 propios y 65 de competencia el
    // real es 35 %, que sobre un objetivo de 35 da exactamente 100.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "05", {
        sosPropios: 35,
        sosCompetencia: [{ marca: "Rival", frentes: 65 }],
      });

      expect(Number(p?.sos_real_pct)).toBe(35);
      expect(Number(p?.visibilidad_pct)).toBe(100);
    });
  });

  it("por debajo del objetivo, el puntaje es proporcional", async () => {
    // 17.5 % real sobre un objetivo de 35 → la mitad.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // `sos_frentes_propios` es un entero: 35 de 200 son el 17,5 %.
      const p = await levantarYPuntuar(c, "06", {
        sosPropios: 35,
        sosCompetencia: [{ marca: "Rival", frentes: 165 }],
      });

      expect(Number(p?.visibilidad_pct)).toBe(50);
    });
  });

  it("superar el objetivo TOPA en 100: no compensa otra variable", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "07", {
        sosPropios: 90,
        sosCompetencia: [{ marca: "Rival", frentes: 10 }],
      });

      expect(Number(p?.sos_real_pct)).toBe(90);
      expect(Number(p?.visibilidad_pct)).toBe(100);
    });
  });

  it("sin medición de SOS queda SIN EVALUAR", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "08", { sosPropios: null });

      expect(p?.visibilidad_pct).toBeNull();
      expect(p?.sos_real_pct).toBeNull();
    });
  });

  it("una góndola vacía —cero propios y cero competencia— no divide por cero", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "09", {
        sosPropios: 0,
        sosCompetencia: [],
      });

      expect(p?.visibilidad_pct).toBeNull();
    });
  });
});

describe("precio y promoción", () => {
  it("el ejemplo del cliente: 40 correctos de 50 dan 80", async () => {
    // "Si tienes 40 bien y 10 mal, tienes 80 sobre 100" (reunión, 3 ago 2026).
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const extra = await codificar(c, 49, true);
      const todos = [IDS.sku, ...extra];
      const skus = todos.map((skuId, i) => ({
        skuId,
        // Los diez últimos, muy por encima del regular: sobreprecio.
        precio: i < 40 ? PRECIO_REGULAR : PRECIO_REGULAR * 2,
      }));

      const p = await levantarYPuntuar(c, "10", { skus });

      expect(p?.skus_precio_evaluados).toBe(50);
      expect(p?.skus_precio_correctos).toBe(40);
      expect(Number(p?.precio_pct)).toBe(80);
    });
  });

  it("dentro de la tolerancia cuenta como correcto", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "11", {
        // 7,24 queda justo dentro del 5 % (el límite es 7,245); 7,25 lo pasaría,
        // y la columna es numeric(10,2), así que no hay margen para el redondeo.
        skus: [{ precio: 7.24 }],
      });

      expect(Number(p?.precio_pct)).toBe(100);
    });
  });

  it("un SKU SIN precio digitado no entra en el denominador", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "12", {
        skus: [{ precio: null, quiebre: { sistema: 5, piso: 5 } }],
      });

      expect(p?.skus_precio_evaluados).toBe(0);
      expect(p?.precio_pct).toBeNull();
    });
  });

  it("un SKU sin precio vigente en el maestro tampoco: falta el dato, no falla la tienda", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const [otro] = await codificar(c, 1);
      const p = await levantarYPuntuar(c, "13", {
        skus: [{ skuId: otro, precio: 9.99 }],
      });

      expect(p?.skus_precio_evaluados).toBe(0);
      expect(p?.precio_pct).toBeNull();
    });
  });

  it("por debajo del regular con una promo comunicada es correcto", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await c.query(
        `insert into public.promocion
           (tenant_id, sku_id, precio_promo, fecha_inicio, fecha_fin, comunicada)
         values ($1, $2, 4.50, app.hoy_lima() - 1, app.hoy_lima() + 1, true)`,
        [TENANTS.maracumango, IDS.sku],
      );

      const p = await levantarYPuntuar(c, "14", { skus: [{ precio: 4.5 }] });

      expect(Number(p?.precio_pct)).toBe(100);
    });
  });

  it("por debajo del regular sin promo NO es correcto", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "15", { skus: [{ precio: 4.5 }] });

      expect(Number(p?.precio_pct)).toBe(0);
      expect(p?.skus_precio_evaluados).toBe(1);
    });
  });
});

describe("orden y limpieza: la escala cualitativa", () => {
  /** Los puntos que la configuración vigente le da a cada nivel. */
  async function puntosDeLaConfig(
    c: Client,
  ): Promise<{ bien: string; regular: string; mal: string }> {
    const r = await c.query<{ bien: string; regular: string; mal: string }>(
      `select orden_bien_pts as bien, orden_regular_pts as regular,
              orden_mal_pts as mal
         from public.config_perfect_store where id = $1`,
      [IDS.configDefault],
    );
    return r.rows[0]!;
  }

  it("'bien' vale lo que diga la configuración, no un 100 escrito en el motor", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const pts = await puntosDeLaConfig(c);
      const p = await levantarYPuntuar(c, "40", {
        orden: "bien",
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      expect(p?.orden_pct).toBe(pts.bien);
    });
  });

  it("'regular' y 'mal' salen igual de la configuración", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const pts = await puntosDeLaConfig(c);
      const reg = await levantarYPuntuar(c, "41", {
        orden: "regular",
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });
      const mal = await levantarYPuntuar(c, "42", {
        orden: "mal",
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      expect(reg?.orden_pct).toBe(pts.regular);
      // "mal" es CERO, y cero no es null: la góndola se evaluó y estaba mal.
      // Confundirlos borraría la diferencia entre un mal trabajo y uno no hecho.
      expect(mal?.orden_pct).toBe(pts.mal);
      expect(mal?.orden_pct).not.toBeNull();
    });
  });

  it("un umbral distinto en la configuración cambia el puntaje", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // Aquí es donde de verdad se rompería "configurable, no en el código": si
      // el motor tuviera el 100 escrito, este test seguiría dando 100.
      await c.query(
        `insert into public.config_perfect_store
           (tenant_id, marca_id, categoria_id, tipo_tienda,
            peso_distribucion, peso_visibilidad, peso_precio, peso_pop, peso_orden,
            sos_objetivo_pct, orden_bien_pts, orden_regular_pts, orden_mal_pts,
            vigente_desde)
         values ($1, $2, null, null, 30, 25, 25, 10, 10, 35, 70, 40, 10, '2026-06-01')`,
        [TENANTS.maracumango, IDS.marca],
      );

      const p = await levantarYPuntuar(c, "43", {
        orden: "bien",
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      expect(p?.orden_pct).toBe("70.00");
    });
  });

  it("cada valor del enum tiene puntos: ninguno se queda sin traducir", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // La regla del proyecto: una función que se ramifica sobre un enum se
      // prueba con TODOS sus valores. El `case` del motor no tiene `else` a
      // propósito —un `raise` ahí haría que el conector descarte el trabajo del
      // mercaderista—, así que un nivel nuevo sin traducir saldría null y su peso
      // se renormalizaría en silencio. Este test es lo que lo delata.
      const niveles = await c.query<{ nivel: string }>(
        `select unnest(enum_range(null::public.nivel_orden))::text as nivel`,
      );
      expect(niveles.rows.length).toBeGreaterThan(0);

      let sufijo = 44;
      for (const { nivel } of niveles.rows) {
        const p = await levantarYPuntuar(c, String(sufijo), {
          orden: nivel as "bien" | "regular" | "mal",
          skus: [{ quiebre: { sistema: 5, piso: 5 } }],
        });
        expect(p?.orden_pct, `el nivel ${nivel} no puntúa`).not.toBeNull();
        sufijo += 1;
      }
    });
  });

  it("el paso omitido por contingencia deja la variable NO evaluada, no en cero", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "48", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      // Null y no 0: con un cero, una góndola que nadie llegó a mirar se leería
      // como una góndola sucia, y el peso de la variable se cobraría entero.
      expect(p?.orden_pct).toBeNull();
      expect(p?.total_pct).not.toBeNull();
    });
  });

  it("la calificación EXIGE su foto", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await levantarYPuntuar(c, "49", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      let codigo = "";
      // Como el MERCADERISTA: el admin no tiene política de escritura sobre
      // `levantamiento`, así que su update no tocaría ninguna fila y la
      // restricción no llegaría a evaluarse — el test pasaría sin probar nada.
      await comoOtro(c, USUARIOS.mercaderistaMaracumango, async () => {
        codigo = await codigoDeError(
          c,
          `update public.levantamiento set orden_nivel = 'bien'
            where id = 'f0000011-0000-0000-0000-000000000049'`,
        );
      });
      // Sin evidencia la nota dependería del criterio del mercaderista, que es
      // justo lo que la reunión quiso evitar.
      expect(codigo).toBe("23514");
    });
  });

  it("la foto tiene que ser DE ESE levantamiento", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await levantarYPuntuar(c, "50", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });
      await levantarYPuntuar(c, "51", {
        orden: "bien",
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      let codigo = "";
      await comoOtro(c, USUARIOS.mercaderistaMaracumango, async () => {
        // La foto del levantamiento 51 no puede sostener la nota del 50: sin la
        // FK de tres columnas, apuntar a la selfie del check-in sería legal.
        codigo = await codigoDeError(
          c,
          `update public.levantamiento
              set orden_nivel = 'bien',
                  orden_foto_id = 'f0000014-0000-0000-0000-000000000051'
            where id = 'f0000011-0000-0000-0000-000000000050'`,
        );
      });
      expect(codigo).toBe("23503");
    });
  });

  it("la acción de borrado de la FK es NO ACTION, no SET NULL", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // Se comprueba en el CATÁLOGO y no borrando una visita de verdad.
      //
      // La prueba end-to-end existió y se retiró: es la única del arnés que hace
      // un `delete from visita`, y al correr en paralelo contra la misma base se
      // daba de bruces con los tests que insertan hijos de otra visita —
      // deadlock medido, con `delete from public.visita` y un `insert into
      // visita_respuesta` esperándose mutuamente. La app NUNCA borra una visita
      // (no hay grant de delete: nada se borra en duro), así que el escenario
      // solo lo alcanza el servidor, y no vale desestabilizar la suite entera
      // por cubrirlo.
      //
      // Lo que sí protege esta aserción es la DECISIÓN: copiar el `on delete set
      // null` de las tres columnas hermanas rompería el borrado en cascada de una
      // visita —la cascada se lleva el levantamiento y a la vez intentaría poner
      // a null esa misma fila, violando el CHECK—, y sin esto ese "arreglo"
      // pasaría verde.
      const r = await c.query<{ accion: string }>(
        `select confdeltype as accion from pg_constraint
          where conname = 'lev_orden_foto_fk'`,
      );
      expect(r.rows[0]?.accion).toBe("a");
    });
  });

  it("no se puede retirar la foto que sostiene una calificación", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await levantarYPuntuar(c, "52", {
        orden: "bien",
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      // Como `postgres`: `authenticated` no tiene delete sobre `foto`. Borrar la
      // evidencia dejaría una nota que ya nadie puede auditar, que es justo lo
      // que la reunión quiso evitar.
      await c.query("set local role postgres");
      const codigo = await codigoDeError(
        c,
        `delete from public.foto where id = 'f0000014-0000-0000-0000-000000000052'`,
      );
      await c.query("set local role authenticated");

      expect(codigo).toBe("23503");
    });
  });

  it("el orden PESA en el total, y su ausencia renormaliza el resto", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // El único test que mira el número del que sale el juicio sobre la tienda.
      // Los demás comprueban `orden_pct` por separado, y los del ponderado dejan
      // la variable nula: entre todos, nadie se daría cuenta de que los
      // argumentos POSICIONALES del ponderador se cruzaron (el 5.º es el material
      // POP, el 6.º el orden) y el peso se estaría aplicando a la variable
      // equivocada.
      //
      // Config del seed: distribución 30 · visibilidad 25 · precio 25 · POP 10 ·
      // orden 10. Se busca a propósito un caso donde las variables NO valgan lo
      // mismo, porque con todas a 100 el total sale 100 pese a cualquier error.
      //
      //   distribución   0 (el SKU en quiebre)
      //   visibilidad  100 (sos real 100 sobre un objetivo de 35, con tope)
      //   precio       100 (registrado al precio regular)
      //   orden          0 ('mal')
      // Sin `as const`: congelaría los arrays como readonly y no encajarían en la
      // firma del helper.
      const comun = {
        sosPropios: 100,
        sosCompetencia: [],
        skus: [{ quiebre: { sistema: 5, piso: 0 }, precio: PRECIO_REGULAR }],
      };

      const conOrden = await levantarYPuntuar(c, "55", {
        ...comun,
        orden: "mal",
      });
      // (0·30 + 100·25 + 100·25 + 0·10) / (30+25+25+10) = 5000/90
      expect(conOrden?.orden_pct).toBe("0.00");
      expect(Number(conOrden?.total_pct)).toBeCloseTo(55.56, 2);

      const sinOrden = await levantarYPuntuar(c, "56", comun);
      // Sin la variable, su peso se REPARTE: (0·30 + 100·25 + 100·25) / 80.
      // Que 55,56 y 62,50 sean distintos es justo lo que separa "la góndola
      // estaba mal" de "nadie la miró".
      expect(sinOrden?.orden_pct).toBeNull();
      expect(Number(sinOrden?.total_pct)).toBeCloseTo(62.5, 2);
    });
  });

  it("el desglose por categoría NO lleva la calificación", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // Hay una sola medición de orden por levantamiento —la góndola es una—, así
      // que repartirla entre categorías sería inventar una medición que nadie
      // hizo. Es la misma decisión que ya se tomó con la visibilidad. Este test
      // fija la omisión para que añadir la columna sea un cambio deliberado y no
      // un descuido que nadie ve.
      await codificar(c, 1, true);
      const conOrden = await levantarYPuntuar(c, "57", {
        orden: "mal",
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });
      expect(conOrden?.orden_pct).toBe("0.00");

      const cat = await c.query<{ total_pct: string | null }>(
        `select total_pct from public.puntaje_perfect_store_categoria
          where levantamiento_id = 'f0000011-0000-0000-0000-000000000057'`,
      );
      const sinOrden = await levantarYPuntuar(c, "58", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });
      const catSin = await c.query<{ total_pct: string | null }>(
        `select total_pct from public.puntaje_perfect_store_categoria
          where levantamiento_id = 'f0000011-0000-0000-0000-000000000058'`,
      );

      // El total del levantamiento SÍ se mueve; el de la categoría no.
      expect(conOrden?.total_pct).not.toBe(sinOrden?.total_pct);
      expect(cat.rows[0]?.total_pct).toBe(catSin.rows[0]?.total_pct);
    });
  });

  it("una calificación que llega tarde recalcula el puntaje", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // El teléfono reintenta una operación rechazada, o el mercaderista corrige
      // la nota: el levantamiento ya está cerrado. Sin ampliar el trigger a esta
      // columna, el puntaje se quedaría calculado sin ella para siempre.
      const antes = await levantarYPuntuar(c, "53", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });
      expect(antes?.orden_pct).toBeNull();

      await comoOtro(c, USUARIOS.mercaderistaMaracumango, async () => {
        // 'mal' y no 'bien': el resto de variables ya valen 100, así que una
        // nota de 100 dejaría el total igual y el test no distinguiría "se
        // recalculó" de "no se tocó nada".
        await calificarOrden(
          c,
          "53",
          "f0000011-0000-0000-0000-000000000053",
          "f0000010-0000-0000-0000-000000000053",
          "mal",
        );
      });

      const despues = await c.query<{
        orden_pct: string | null;
        total_pct: string | null;
      }>(
        `select orden_pct, total_pct from public.puntaje_perfect_store
          where levantamiento_id = 'f0000011-0000-0000-0000-000000000053'`,
      );
      expect(despues.rows[0]?.orden_pct).not.toBeNull();
      expect(despues.rows[0]?.total_pct).not.toBe(antes?.total_pct);
    });
  });

  it("un levantamiento omitido no deja puntaje aunque esté calificado", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "54", {
        orden: "bien",
        estado: "omitido",
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      expect(p).toBeNull();
    });
  });
});

describe("material POP y activación", () => {
  /** Publica una configuración con la política y el peso de POP que se quieran. */
  async function conPolitica(
    c: Client,
    politica: string,
    pesoPop = 10,
  ): Promise<void> {
    await c.query("set local role postgres");
    await c.query(
      `insert into public.config_perfect_store
         (tenant_id, marca_id, categoria_id, tipo_tienda,
          peso_distribucion, peso_visibilidad, peso_precio, peso_pop, peso_orden,
          sos_objetivo_pct, politica_pop, vigente_desde)
       values ($1, $2, null, null, $3, 25, 25, $4, 10, 35,
               $5::public.politica_pop, '2026-06-01')`,
      [
        TENANTS.maracumango,
        IDS.marca,
        // Los pesos tienen que sumar 100: lo que se le quite a POP se le da a
        // distribución.
        100 - 25 - 25 - pesoPop - 10,
        pesoPop,
        politica,
      ],
    );
    await c.query("set local role authenticated");
  }

  it("una comprometida instalada y completa vale 100", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const neg = await conNegociada(c, "60");
      const p = await levantarYPuntuar(c, "60", {
        exhibiciones: [{ negociada: neg, instalada: true, completa: true }],
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      expect(p?.pop_pct).toBe("100.00");
    });
  });

  it("instalada pero INCOMPLETA vale la mitad: presencia sin estado no es cumplimiento", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const neg = await conNegociada(c, "61");
      const p = await levantarYPuntuar(c, "61", {
        exhibiciones: [{ negociada: neg, instalada: true, completa: false }],
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      expect(p?.pop_pct).toBe("50.00");
    });
  });

  it("no instalada vale 0, y eso NO es lo mismo que no evaluada", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const neg = await conNegociada(c, "62");
      const p = await levantarYPuntuar(c, "62", {
        exhibiciones: [{ negociada: neg, instalada: false }],
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      // Se comprometió y no está: cero de cumplimiento, con la variable SÍ
      // evaluada. Confundirlo con null borraría la diferencia entre "la tienda
      // no lo montó" y "la marca no negoció nada".
      expect(p?.pop_pct).toBe("0.00");
      expect(p?.pop_pct).not.toBeNull();
    });
  });

  it("una exhibición no vigente no cuenta como presente", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const neg = await conNegociada(c, "63");
      const p = await levantarYPuntuar(c, "63", {
        exhibiciones: [
          { negociada: neg, instalada: true, completa: true, vigente: false },
        ],
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      expect(p?.pop_pct).toBe("0.00");
    });
  });

  it("`completa` sin escribir NO penaliza: el estado no se midió", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // Hoy el móvil no escribe `completa` en ninguna fila. Sin el coalesce del
      // motor, el día del despliegue TODA exhibición instalada caería de 100 a 50
      // sin que nada hubiera cambiado en la tienda.
      const neg = await conNegociada(c, "64");
      const p = await levantarYPuntuar(c, "64", {
        exhibiciones: [{ negociada: neg, instalada: true }],
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      expect(p?.pop_pct).toBe("100.00");
    });
  });

  it("una CONSEGUIDA sin `instalada` escrita puntúa: existe porque se consiguió", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // El móvil tampoco escribe `instalada` en las conseguidas. Sin el coalesce,
      // el premio se convertiría en castigo.
      const neg = await conNegociada(c, "65");
      const p = await levantarYPuntuar(c, "65", {
        exhibiciones: [
          { negociada: neg, instalada: false },
          { tipoAdicional: "jalavista" },
        ],
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      // La comprometida da 0, la conseguida da 100, y el denominador es 1 (solo
      // lo comprometido): la conseguida COMPENSA de verdad.
      expect(p?.pop_pct).toBe("100.00");
    });
  });

  it("dos comprometidas, una sí y otra no, dan la mitad", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const a = await conNegociada(c, "66");
      const b = await conNegociada(c, "67", "glorificador");
      const p = await levantarYPuntuar(c, "66", {
        exhibiciones: [
          { negociada: a, instalada: true, completa: true },
          { negociada: b, instalada: false },
        ],
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      expect(p?.pop_pct).toBe("50.00");
    });
  });

  it("lo conseguido no dispara la variable por encima de 100", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const neg = await conNegociada(c, "68");
      const p = await levantarYPuntuar(c, "68", {
        exhibiciones: [
          { negociada: neg, instalada: true, completa: true },
          { tipoAdicional: "activacion", instalada: true, completa: true },
        ],
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      // 200 puntos sobre 1 comprometida serían 200: el `least` lo topa. La
      // columna tiene un CHECK de 0-100 y sin el tope la escritura reventaría.
      expect(p?.pop_pct).toBe("100.00");
    });
  });

  it("sin nada comprometido la variable NO se evalúa, y el total no baja", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const conPop = await levantarYPuntuar(c, "69", {
        exhibiciones: [{ tipoAdicional: "jalavista", instalada: true }],
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });
      const sinNada = await levantarYPuntuar(c, "70", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      // El caso que el ticket pide decidir: hay conseguido pero no hay
      // compromiso. La variable mide CUMPLIMIENTO de un compromiso; sin
      // compromiso no hay nada que cumplir, así que no se evalúa y su peso se
      // renormaliza. Un 0 penalizaría a la marca que no negoció material; un 100
      // premiaría a la que no invirtió.
      expect(conPop?.pop_pct).toBeNull();
      expect(sinNada?.pop_pct).toBeNull();
      expect(conPop?.total_pct).toBe(sinNada?.total_pct);
    });
  });

  it("`dentro_del_tope`: el POP pondera como una más y el total no pasa de 100", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await conPolitica(c, "dentro_del_tope");
      const a = await conNegociada(c, "71");
      const b = await conNegociada(c, "72", "jalavista");
      const p = await levantarYPuntuar(c, "71", {
        sosPropios: 100,
        sosCompetencia: [],
        exhibiciones: [
          { negociada: a, instalada: true, completa: true },
          { negociada: b, instalada: false },
        ],
        skus: [{ quiebre: { sistema: 5, piso: 5 }, precio: PRECIO_REGULAR }],
      });

      // dist 100 · vis 100 · precio 100 · orden null · pop 50, pesos 30/25/25/10.
      // (30·100 + 25·100 + 25·100 + 10·50) / 90 = 8500/90 = 94.44
      expect(p?.pop_pct).toBe("50.00");
      expect(Number(p?.total_pct)).toBeCloseTo(94.44, 2);
      expect(Number(p?.total_pct)).toBeLessThanOrEqual(100);
    });
  });

  it("`bonus_sobre_100`: el POP se suma POR ENCIMA y el total llega a 110", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await conPolitica(c, "bonus_sobre_100");
      const neg = await conNegociada(c, "73");
      const p = await levantarYPuntuar(c, "73", {
        sosPropios: 100,
        sosCompetencia: [],
        exhibiciones: [{ negociada: neg, instalada: true, completa: true }],
        skus: [{ quiebre: { sistema: 5, piso: 5 }, precio: PRECIO_REGULAR }],
      });

      // La frase literal del cliente: "podrías tener 100 puntos de perfect store
      // y esto te suma y te lleva a 110".
      //
      // base  = (30·100 + 25·100 + 25·100) / 80 = 100.00  (el POP sale del promedio)
      // bonus = 10 · 100 / 100 = 10.00
      expect(p?.pop_pct).toBe("100.00");
      expect(Number(p?.total_pct)).toBeCloseTo(110, 2);
    });
  });

  it("en modo bonus un POP malo no RESTA: deja de sumar", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await conPolitica(c, "bonus_sobre_100");
      const neg = await conNegociada(c, "74");
      const conMalPop = await levantarYPuntuar(c, "74", {
        sosPropios: 100,
        sosCompetencia: [],
        exhibiciones: [{ negociada: neg, instalada: false }],
        skus: [{ quiebre: { sistema: 5, piso: 5 }, precio: PRECIO_REGULAR }],
      });
      const sinPop = await levantarYPuntuar(c, "75", {
        sosPropios: 100,
        sosCompetencia: [],
        skus: [{ quiebre: { sistema: 5, piso: 5 }, precio: PRECIO_REGULAR }],
      });

      // Eso ES un bonus: el suelo no se mueve. Con `dentro_del_tope` el mismo
      // dato bajaría el total.
      expect(conMalPop?.pop_pct).toBe("0.00");
      expect(Number(conMalPop?.total_pct)).toBeGreaterThanOrEqual(
        Number(sinPop?.total_pct),
      );
    });
  });

  it("cada política del enum produce un total: ninguna se queda sin traducir", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // El `case` de `app.total_perfect_store` no tiene `else` a propósito: una
      // política nueva sin traducir devuelve NULL en vez de un número plausible
      // del que se juzga a una tienda. Este test es lo que lo delata.
      const r = await c.query<{ politica: string; total: string | null }>(
        `select p::text as politica,
                app.total_perfect_store(
                  (select c from public.config_perfect_store c
                    where c.id = $1),
                  100, 100, 100, 100, 100)::text as total
           from unnest(enum_range(null::public.politica_pop)) as p`,
        [IDS.configDefault],
      );
      expect(r.rows.length).toBeGreaterThan(0);
      for (const fila of r.rows) {
        expect(
          fila.total,
          `la política '${fila.politica}' no traduce`,
        ).not.toBeNull();
      }
    });
  });

  it("el total acepta 110 y sigue rechazando lo imposible", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // Sobre un puntaje REAL, creado aquí: el seed deja sus levantamientos
      // pendientes y esta tabla vacía, y un update de cero filas no evalúa
      // ningún CHECK — el test pasaría en verde sin probar nada.
      await levantarYPuntuar(c, "82", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      await c.query("set local role postgres");
      const ok = await codigoDeError(
        c,
        `update public.puntaje_perfect_store set total_pct = 110
          where levantamiento_id = 'f0000011-0000-0000-0000-000000000082'`,
      );
      const malo = await codigoDeError(
        c,
        `update public.puntaje_perfect_store set total_pct = 201
          where levantamiento_id = 'f0000011-0000-0000-0000-000000000082'`,
      );
      await c.query("set local role authenticated");

      // El techo real es 100 + peso_pop, y peso_pop llega a 100: por eso el rango
      // es 0-200 y no 0-110.
      expect(ok).toBe("");
      expect(malo).toBe("23514");
    });
  });

  it("el desglose por categoría no se mueve con el POP", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await codificar(c, 1, true);
      const neg = await conNegociada(c, "76");
      await levantarYPuntuar(c, "76", {
        exhibiciones: [{ negociada: neg, instalada: false }],
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });
      await levantarYPuntuar(c, "77", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      const con = await c.query<{ total_pct: string | null }>(
        `select total_pct from public.puntaje_perfect_store_categoria
          where levantamiento_id = 'f0000011-0000-0000-0000-000000000076'`,
      );
      const sin = await c.query<{ total_pct: string | null }>(
        `select total_pct from public.puntaje_perfect_store_categoria
          where levantamiento_id = 'f0000011-0000-0000-0000-000000000077'`,
      );

      // Hay una sola medición de POP por levantamiento; repartirla entre
      // categorías sería inventarla. Mismo criterio que la visibilidad y el orden.
      expect(con.rows[0]?.total_pct).toBe(sin.rows[0]?.total_pct);
    });
  });

  it("una exhibición que llega DESPUÉS del cierre recalcula el puntaje", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const neg = await conNegociada(c, "78");
      const antes = await levantarYPuntuar(c, "78", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });
      expect(antes?.pop_pct).toBeNull();

      // El teléfono reintenta una fila rechazada, o el mercaderista reentra al
      // paso: el levantamiento ya está cerrado. Sin el trigger, el `pop_pct` se
      // quedaría corto para siempre.
      await comoOtro(c, USUARIOS.mercaderistaMaracumango, async () => {
        await c.query(
          `insert into public.exhibicion
             (tenant_id, levantamiento_id, exhibicion_negociada_id, instalada, completa)
           values ($1, 'f0000011-0000-0000-0000-000000000078', $2, true, true)`,
          [TENANTS.maracumango, neg],
        );
      });

      const despues = await c.query<{ pop_pct: string | null }>(
        `select pop_pct from public.puntaje_perfect_store
          where levantamiento_id = 'f0000011-0000-0000-0000-000000000078'`,
      );
      expect(despues.rows[0]?.pop_pct).toBe("100.00");
    });
  });

  it("la foto de la exhibición tiene que ser DE ESE levantamiento", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const neg = await conNegociada(c, "79");
      await levantarYPuntuar(c, "79", {
        exhibiciones: [{ negociada: neg, instalada: true }],
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });
      await levantarYPuntuar(c, "80", {
        orden: "bien",
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      // La foto del levantamiento 80 no puede ser la evidencia de una exhibición
      // del 79: sin la FK de tres columnas, apuntar a la selfie del check-in
      // sería legal.
      const codigo = await comoOtro(
        c,
        USUARIOS.mercaderistaMaracumango,
        async () =>
          codigoDeError(
            c,
            `update public.exhibicion
                set foto_id = 'f0000014-0000-0000-0000-000000000080'
              where levantamiento_id = 'f0000011-0000-0000-0000-000000000079'`,
          ),
      );
      expect(codigo).toBe("23503");
    });
  });

  it("la evidencia no se puede retirar por debajo: la FK es NO ACTION", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await c.query<{ accion: string }>(
        `select confdeltype as accion from pg_constraint
          where conname = 'exh_foto_fk'`,
      );
      // `set null` —lo que tenía antes— tropezaría con la cascada de una visita,
      // igual que documentó la variable de orden.
      expect(r.rows[0]?.accion).toBe("a");
    });
  });

  it("los tipos nuevos se registran, comprometidos y conseguidos", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const neg = await conNegociada(c, "81", "glorificador");
      const p = await levantarYPuntuar(c, "81", {
        exhibiciones: [
          { negociada: neg, instalada: true, completa: true },
          { tipoAdicional: "activacion", instalada: true, completa: true },
        ],
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      expect(p?.pop_pct).toBe("100.00");
    });
  });
});

describe("cuándo NO se deja puntaje", () => {
  it("un levantamiento OMITIDO por contingencia no puntúa cero: no deja fila", async () => {
    // Es el criterio de aceptación. Un cero convertiría en "mal ejecutada" una
    // tienda donde el mercaderista no pudo hacer el paso.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "16", {
        estado: "omitido",
        skus: [{ quiebre: { sistema: 5, piso: 0 } }],
      });

      expect(p).toBeNull();
    });
  });

  it("una marca SIN configuración no puntúa: no se inventa un default", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      // No se borra la configuración —nadie puede, y es deliberado—: se usa la
      // segunda marca del cliente, que no tiene ninguna.
      const p = await levantarYPuntuar(c, "17", {
        marcaId: IDS.marcaSinConfig,
      });

      expect(p).toBeNull();
    });
  });

  it("volver a `en_curso` retira el puntaje que había", async () => {
    // Reabrir un levantamiento invalida su número: dejarlo sería enseñar el
    // puntaje de una foto que ya no es la actual.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "18", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });
      expect(p).not.toBeNull();

      // Como MERCADERISTA: un update que la RLS bloquea afecta a 0 filas sin dar
      // error, el disparador no llega a correr y el test pasaría creyendo que el
      // puntaje se conservó a propósito.
      await comoOtro(c, USUARIOS.mercaderistaMaracumango, () =>
        c.query(
          `update public.levantamiento set estado = 'en_curso'
           where id = 'f0000011-0000-0000-0000-000000000018'`,
        ),
      );

      const r = await c.query(
        `select 1 from public.puntaje_perfect_store
         where levantamiento_id = 'f0000011-0000-0000-0000-000000000018'`,
      );
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("un levantamiento que NACE completado también puntúa", () => {
  it("puntúa al insertarlo, no solo al actualizarlo", async () => {
    // El camino normal es crear `en_curso` y luego completar —y el conector de
    // PowerSync reaplica las operaciones en ese orden—, pero nada obliga a que
    // sea el único. Un puntaje que falta porque el levantamiento llegó por otra
    // puerta no se nota.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const visita = "f0000010-0000-0000-0000-000000000030";
      const lev = "f0000011-0000-0000-0000-000000000030";

      await comoOtro(c, USUARIOS.mercaderistaMaracumango, async () => {
        await c.query(
          `insert into public.visita (id, tenant_id, rutero_parada_id, mercaderista_id, tienda_id, estado, check_in_at)
           values ($1, $2, $3, $4, $5, 'en_curso', now())`,
          [
            visita,
            TENANTS.maracumango,
            IDS.parada,
            USUARIOS.mercaderistaMaracumango,
            IDS.tienda,
          ],
        );
        await c.query(
          `insert into public.levantamiento (id, tenant_id, visita_id, marca_id, estado)
           values ($1, $2, $3, $4, 'completado')`,
          [lev, TENANTS.maracumango, visita, IDS.marca],
        );
      });

      const r = await c.query(
        `select 1 from public.puntaje_perfect_store where levantamiento_id = $1`,
        [lev],
      );
      expect(r.rowCount).toBe(1);
    });
  });
});

describe("un SKU que llega tarde corrige el puntaje", () => {
  it("recalcula si el levantamiento ya estaba cerrado", async () => {
    // El orden normal lo garantiza el conector de PowerSync. Pero una operación
    // rechazada y reintentada más tarde dejaría el puntaje sobre un subconjunto,
    // y sin recálculo no se corregiría nunca — un número corto en silencio es
    // peor que uno que falta.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "31", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });
      expect(Number(p?.distribucion_pct)).toBe(100);
      expect(p?.skus_evaluados).toBe(1);

      // Un segundo SKU codificado, en quiebre, que llega DESPUÉS del cierre.
      const [tarde] = await codificar(c, 1);
      await comoOtro(c, USUARIOS.mercaderistaMaracumango, () =>
        c.query(
          `insert into public.levantamiento_sku
             (tenant_id, levantamiento_id, sku_id, stock_sistema, stock_piso)
           values ($1, 'f0000011-0000-0000-0000-000000000031', $2, 5, 0)`,
          [TENANTS.maracumango, tarde],
        ),
      );

      const r = await c.query<{
        distribucion_pct: string;
        skus_evaluados: number;
      }>(
        `select distribucion_pct, skus_evaluados from public.puntaje_perfect_store
         where levantamiento_id = 'f0000011-0000-0000-0000-000000000031'`,
      );
      expect(r.rows[0]?.skus_evaluados).toBe(2);
      expect(Number(r.rows[0]?.distribucion_pct)).toBe(50);
    });
  });
});

describe("el puntaje guarda con qué se calculó", () => {
  it("referencia la configuración vigente", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const p = await levantarYPuntuar(c, "19", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      expect(p?.config_id).toBe(IDS.configDefault);
    });
  });

  it("la configuración referenciada no se puede borrar", async () => {
    // `on delete restrict`: sin él, borrar una configuración dejaría puntajes
    // que ya nadie puede explicar.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await levantarYPuntuar(c, "20", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });

      let codigo = "";
      try {
        await c.query(`delete from public.config_perfect_store where id = $1`, [
          IDS.configDefault,
        ]);
      } catch (err) {
        codigo = (err as { code?: string }).code ?? "";
      }
      expect(codigo).not.toBe("");
    });
  });
});

describe("quién ve el puntaje", () => {
  it("el cliente-marca ve el suyo", async () => {
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      await levantarYPuntuar(c, "21", {
        skus: [{ quiebre: { sistema: 5, piso: 5 } }],
      });
    });

    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      const r = await c.query(
        `select 1 from public.puntaje_perfect_store where tenant_id = $1`,
        [TENANTS.rival],
      );
      expect(r.rowCount).toBe(0);
    });
  });

  it("nadie lo ESCRIBE desde una app: lo produce el servidor", async () => {
    // Sin esto, una app podría maquillar su propio número.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      let codigo = "";
      try {
        await c.query(
          `insert into public.puntaje_perfect_store
             (levantamiento_id, tenant_id, config_id, distribucion_pct)
           values ('a0000011-0000-0000-0000-000000000001', $1, $2, 100)`,
          [TENANTS.maracumango, IDS.configDefault],
        );
      } catch (err) {
        codigo = (err as { code?: string }).code ?? "";
      }
      expect(codigo).toBe("42501");
    });
  });
});
