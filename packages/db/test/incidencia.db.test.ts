import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// El motor de incidencias de visita: el hallazgo que el mercaderista tiene que
// atender antes de salir, y que NADIE declara — nace del dato levantado.
//
// Se prueba por el camino REAL del móvil, que es lo que distingue este archivo
// de `alertas.db.test.ts`: allí la fila de `levantamiento_sku` se inserta entera
// en un solo statement, y la app nunca hace eso. El wizard la crea en el paso
// "Antes + SOS" con solo `frentes_propios`, y el stock y el precio llegan
// después como UPDATE. Un motor atado a `after insert` pasaría aquel test en
// verde y no produciría nada en producción.
//
// Cada test monta una cadena FRESCA (ids nuevos) dentro de la transacción con
// rollback de `comoUsuario`, y todas las aserciones se acotan a la visita que el
// propio test sembró: un `count(*)` sobre la tabla entera se rompería con la
// fila que deja otra sesión, o pasaría en verde tapando un fallo real.

const PARADA = "a0000009-0000-0000-0000-000000000001";
const TIENDA = "a0000002-0000-0000-0000-000000000001";
const MARCA = "cccccccc-0000-0000-0000-000000000001";
// Precio regular 6.90 con tolerancia de marca del 5%: correcto en [6.56, 7.24].
const SKU = "a0000003-0000-0000-0000-000000000001";
const EXH_NEGOCIADA = "a0000007-0000-0000-0000-000000000001";

// Las visitas del seed. La de José ya trae un `levantamiento_sku` en quiebre
// (20 de sistema, 0 de piso), así que su incidencia existe desde el `db reset`:
// es el control positivo de las pruebas de lectura.
const VISITA_JOSE = "a0000010-0000-0000-0000-000000000001";
const VISITA_RIVAL = "b0000010-0000-0000-0000-000000000002";

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

// `null` es un valor con significado, no la ausencia del campo: es lo que
// escribe el mercaderista cuando BORRA el precio, y el motor tiene que anular
// las incidencias que ese precio sostenía.
type CamposSku = {
  stock_sistema?: number | null;
  stock_piso?: number | null;
  precio_registrado?: number | null;
  hay_promo?: boolean | null;
  promo_comunicada?: boolean | null;
};

type Cadena = {
  visita: string;
  levantamiento: string;
  levantamientoSku: string;
};

/** Abre la visita y su levantamiento, sin tocar todavía `levantamiento_sku`. */
async function abrirVisita(c: Client, sufijo: string): Promise<Cadena> {
  const cadena = {
    visita: `e0000010-0000-0000-0000-0000000000${sufijo}`,
    levantamiento: `e0000011-0000-0000-0000-0000000000${sufijo}`,
    levantamientoSku: `e0000012-0000-0000-0000-0000000000${sufijo}`,
  };
  await c.query(
    `insert into public.visita (id, rutero_parada_id, mercaderista_id, tienda_id, estado, check_in_at)
     values ($1,$2,$3,$4,'en_curso', now())`,
    [cadena.visita, PARADA, USUARIOS.mercaderistaMaracumango, TIENDA],
  );
  await c.query(
    `insert into public.levantamiento (id, visita_id, marca_id) values ($1,$2,$3)`,
    [cadena.levantamiento, cadena.visita, MARCA],
  );
  return cadena;
}

/**
 * El paso "Antes + SOS": CREA la fila del SKU con solo los frentes, igual que
 * `upsertLevantamientoSku` cuando todavía no hay `ls_id`. Ni stock ni precio.
 */
async function pasoSos(c: Client, cadena: Cadena): Promise<void> {
  await c.query(
    `insert into public.levantamiento_sku (id, levantamiento_id, sku_id, frentes_propios)
     values ($1,$2,$3,4)`,
    [cadena.levantamientoSku, cadena.levantamiento, SKU],
  );
}

/** Un paso posterior del wizard: UPDATE sobre la fila que creó el paso SOS. */
async function pasoActualiza(
  c: Client,
  cadena: Cadena,
  campos: CamposSku,
): Promise<void> {
  const cols = Object.keys(campos);
  const vals = Object.values(campos);
  await c.query(
    `update public.levantamiento_sku
        set ${cols.map((col, i) => `${col} = $${i + 2}`).join(", ")}
      where id = $1`,
    [cadena.levantamientoSku, ...vals],
  );
}

/** El camino completo del wizard: SOS → quiebres → precios. Tres escrituras. */
async function levantarEnPasos(
  c: Client,
  sufijo: string,
  campos: CamposSku,
): Promise<Cadena> {
  const cadena = await abrirVisita(c, sufijo);
  await pasoSos(c, cadena);
  if (campos.stock_sistema !== undefined || campos.stock_piso !== undefined) {
    await pasoActualiza(c, cadena, {
      stock_sistema: campos.stock_sistema,
      stock_piso: campos.stock_piso,
    });
  }
  if (campos.precio_registrado !== undefined) {
    await pasoActualiza(c, cadena, {
      precio_registrado: campos.precio_registrado,
      hay_promo: campos.hay_promo,
      promo_comunicada: campos.promo_comunicada,
    });
  }
  return cadena;
}

type Incidencia = {
  origen: string;
  estado: string;
  detalle: Record<string, unknown>;
  accion_tomada: string | null;
  sku_id: string | null;
  exhibicion_negociada_id: string | null;
};

async function incidenciasDe(c: Client, visita: string): Promise<Incidencia[]> {
  const r = await c.query<Incidencia>(
    `select origen, estado, detalle, accion_tomada, sku_id, exhibicion_negociada_id
       from public.incidencia where visita_id = $1 order by origen`,
    [visita],
  );
  return r.rows;
}

describe("motor de incidencias — un origen por hallazgo", () => {
  it("un quiebre genera una incidencia de quiebre", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "a1", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      const incidencias = await incidenciasDe(c, cadena.visita);
      expect(incidencias.map((i) => i.origen)).toEqual(["quiebre"]);
      expect(incidencias[0]?.estado).toBe("pendiente");
      // El detalle viaja con los números: el móvil los pinta sin recalcular.
      expect(incidencias[0]?.detalle).toMatchObject({
        stock_sistema: 10,
        stock_piso: 0,
      });
      expect(incidencias[0]?.sku_id).toBe(SKU);
    });
  });

  it("una diferencia de stock genera su incidencia", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "a2", {
        stock_sistema: 5,
        stock_piso: 3,
      });
      const incidencias = await incidenciasDe(c, cadena.visita);
      expect(incidencias.map((i) => i.origen)).toEqual(["diferencia_stock"]);
      expect(incidencias[0]?.detalle).toMatchObject({ delta: -2 });
    });
  });

  it("un precio por encima de la tolerancia genera desviación de precio", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "a3", {
        precio_registrado: 8.9,
      });
      const incidencias = await incidenciasDe(c, cadena.visita);
      expect(incidencias.map((i) => i.origen)).toEqual(["desviacion_precio"]);
      expect(incidencias[0]?.detalle).toMatchObject({ motivo: "sobreprecio" });
    });
  });

  it("un precio por debajo del regular sin promo genera desviación de precio", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "a4", {
        precio_registrado: 5.0,
        hay_promo: false,
      });
      const incidencias = await incidenciasDe(c, cadena.visita);
      expect(incidencias.map((i) => i.origen)).toEqual(["desviacion_precio"]);
      expect(incidencias[0]?.detalle).toMatchObject({
        motivo: "subvaluado_sin_promo",
      });
    });
  });

  it("una promo vista en tienda y no comunicada genera su propia incidencia", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "a5", {
        precio_registrado: 5.0,
        hay_promo: true,
        promo_comunicada: false,
      });
      const incidencias = await incidenciasDe(c, cadena.visita);
      expect(incidencias.map((i) => i.origen)).toEqual(["promo_no_comunicada"]);
    });
  });

  it("una exhibición negociada sin instalar genera su incidencia", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await abrirVisita(c, "a6");
      await c.query(
        `insert into public.exhibicion (id, levantamiento_id, exhibicion_negociada_id, instalada)
         values ($1,$2,$3,false)`,
        [
          "e0000013-0000-0000-0000-0000000000a6",
          cadena.levantamiento,
          EXH_NEGOCIADA,
        ],
      );
      const incidencias = await incidenciasDe(c, cadena.visita);
      expect(incidencias.map((i) => i.origen)).toEqual([
        "exhibicion_no_instalada",
      ]);
      expect(incidencias[0]?.exhibicion_negociada_id).toBe(EXH_NEGOCIADA);
      // Cuelga de la exhibición negociada, no de un SKU: es un hallazgo de la
      // góndola entera.
      expect(incidencias[0]?.sku_id).toBeNull();
    });
  });

  it("una exhibición ADICIONAL sin instalar no genera nada: no incumple nada", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await abrirVisita(c, "a7");
      await c.query(
        `insert into public.exhibicion (id, levantamiento_id, tipo_adicional, instalada)
         values ($1,$2,'isla',false)`,
        ["e0000013-0000-0000-0000-0000000000a7", cadena.levantamiento],
      );
      expect(await incidenciasDe(c, cadena.visita)).toEqual([]);
    });
  });

  it("un levantamiento sin hallazgos no genera ninguna incidencia", async () => {
    // El caso negativo. Sin él, un motor que las creara SIEMPRE pasaría todos
    // los tests de arriba y nadie se enteraría hasta ver la lista del móvil.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "a8", {
        stock_sistema: 7,
        stock_piso: 7,
        precio_registrado: 6.9,
      });
      expect(await incidenciasDe(c, cadena.visita)).toEqual([]);
    });
  });

  it("nada crea todavía una incidencia de planograma", async () => {
    // Pin de contrato: el valor existe en el enum para que el ticket del
    // planograma añada solo su rama de trigger —añadir un valor a un enum obliga
    // a su propia migración—, pero hoy la entidad no existe y NADIE lo escribe.
    await comoUsuario(db, USUARIOS.admin, async (c) => {
      const r = await c.query<{ n: string }>(
        `select count(*)::text as n from public.incidencia
          where origen = 'incumplimiento_planograma'`,
      );
      expect(r.rows[0]?.n).toBe("0");
    });
  });
});

describe("motor de incidencias — un hallazgo, una incidencia", () => {
  it("el camino real del wizard (SOS, luego stock, luego precio) deja UNA por hallazgo", async () => {
    // El caso que da sentido al ticket. El móvil escribe la fila en tres pasadas
    // y el trigger se dispara en las tres: sin la clave natural habría tres
    // incidencias de quiebre, y con un trigger `after insert` no habría ninguna.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "b1", {
        stock_sistema: 10,
        stock_piso: 0,
        precio_registrado: 8.9,
      });
      const incidencias = await incidenciasDe(c, cadena.visita);
      // El orden es el del enum, no el alfabético: `origen` es un enum de
      // Postgres y ordena por posición declarada.
      expect(incidencias.map((i) => i.origen)).toEqual([
        "quiebre",
        "desviacion_precio",
      ]);
    });
  });

  it("reentrar al paso y volver a guardar lo mismo no duplica", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "b2", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      await pasoActualiza(c, cadena, { stock_sistema: 10, stock_piso: 0 });
      await pasoActualiza(c, cadena, { stock_sistema: 10, stock_piso: 0 });
      const incidencias = await incidenciasDe(c, cadena.visita);
      expect(incidencias.map((i) => i.origen)).toEqual(["quiebre"]);
    });
  });

  it("el upsert de reintento de PowerSync tampoco duplica", async () => {
    // El conector reenvía la operación como `insert … on conflict do update`
    // cuando la primera no confirmó: el trigger vuelve a correr sobre la misma
    // fila y tiene que caer en el conflicto, no crear una segunda incidencia.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "b3", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      await c.query(
        `insert into public.levantamiento_sku
           (id, levantamiento_id, sku_id, stock_sistema, stock_piso)
         values ($1,$2,$3,10,0)
         on conflict (id) do update set stock_sistema = excluded.stock_sistema,
                                        stock_piso = excluded.stock_piso`,
        [cadena.levantamientoSku, cadena.levantamiento, SKU],
      );
      const incidencias = await incidenciasDe(c, cadena.visita);
      expect(incidencias.map((i) => i.origen)).toEqual(["quiebre"]);
    });
  });

  it("mientras sigue pendiente, el detalle se refresca con los números de ahora", async () => {
    // El hallazgo sigue siendo el mismo (piso 0), así que la incidencia no se
    // duplica; pero el sistema pasó de 10 a 15 y el teléfono tiene que enseñar
    // el número de ahora. Es la mitad del predicado del upsert que los tests de
    // idempotencia no ejercitan: ellos reenvían siempre los MISMOS valores.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "b5", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      await pasoActualiza(c, cadena, { stock_sistema: 15, stock_piso: 0 });
      const incidencias = await incidenciasDe(c, cadena.visita);
      expect(incidencias).toHaveLength(1);
      expect(incidencias[0]?.detalle).toMatchObject({ stock_sistema: 15 });
    });
  });

  it("una vez atendida, el detalle queda congelado con lo que se resolvió", async () => {
    // El detalle es la foto del hallazgo tal como estaba cuando el mercaderista
    // lo resolvió, y el puntaje condicional puntuará sobre ella. Refrescarlo
    // después dejaría una acción tomada explicando unos números que la fila ya
    // no enseña.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "b6", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      await c.query(
        `update public.incidencia
            set estado = 'resuelta', accion_tomada = 'Repuse 10 unidades',
                atendida_at = now()
          where visita_id = $1`,
        [cadena.visita],
      );
      await pasoActualiza(c, cadena, { stock_sistema: 15, stock_piso: 0 });
      const incidencias = await incidenciasDe(c, cadena.visita);
      expect(incidencias[0]?.estado).toBe("resuelta");
      expect(incidencias[0]?.detalle).toMatchObject({ stock_sistema: 10 });
    });
  });

  it("volver a guardar el paso NO pisa lo que el mercaderista ya atendió", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "b4", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      await c.query(
        `update public.incidencia
            set estado = 'resuelta', accion_tomada = 'Repuse 10 unidades',
                atendida_at = now()
          where visita_id = $1`,
        [cadena.visita],
      );
      await pasoActualiza(c, cadena, { stock_sistema: 10, stock_piso: 0 });
      const incidencias = await incidenciasDe(c, cadena.visita);
      expect(incidencias).toHaveLength(1);
      expect(incidencias[0]?.estado).toBe("resuelta");
      expect(incidencias[0]?.accion_tomada).toBe("Repuse 10 unidades");
    });
  });
});

describe("motor de incidencias — el hallazgo que deja de existir", () => {
  it("corregir el stock anula la incidencia pendiente", async () => {
    // Un stock mal tecleado y luego corregido dejaría, si no, una incidencia
    // imposible de atender: la verja de check-out se cerraría para siempre
    // sobre un hallazgo que ya no existe.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "c1", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      await pasoActualiza(c, cadena, { stock_sistema: 10, stock_piso: 10 });
      const incidencias = await incidenciasDe(c, cadena.visita);
      expect(incidencias.map((i) => i.estado)).toEqual(["anulada"]);
    });
  });

  it("si el hallazgo vuelve, la incidencia anulada revive como pendiente", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "c2", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      await pasoActualiza(c, cadena, { stock_sistema: 10, stock_piso: 10 });
      await pasoActualiza(c, cadena, { stock_sistema: 10, stock_piso: 0 });
      const incidencias = await incidenciasDe(c, cadena.visita);
      expect(incidencias).toHaveLength(1);
      expect(incidencias[0]?.estado).toBe("pendiente");
    });
  });

  it("lo ya atendido NO se anula: sigue siendo la prueba de que pasó", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "c3", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      await c.query(
        `update public.incidencia
            set estado = 'resuelta', accion_tomada = 'Repuse el producto',
                atendida_at = now()
          where visita_id = $1`,
        [cadena.visita],
      );
      await pasoActualiza(c, cadena, { stock_sistema: 10, stock_piso: 10 });
      const incidencias = await incidenciasDe(c, cadena.visita);
      expect(incidencias.map((i) => i.estado)).toEqual(["resuelta"]);
    });
  });

  it("corregir el precio anula la incidencia de precio", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "c4", {
        precio_registrado: 8.9,
      });
      await pasoActualiza(c, cadena, { precio_registrado: 6.9 });
      const incidencias = await incidenciasDe(c, cadena.visita);
      expect(incidencias.map((i) => i.estado)).toEqual(["anulada"]);
    });
  });

  it("borrar el precio anula LAS DOS incidencias de precio", async () => {
    // La rama que se dispara cuando el mercaderista deja el precio vacío: sin
    // ella, las dos incidencias de precio sobreviven a la corrección que las
    // desmiente y la verja de check-out se cierra sobre un hallazgo que ya no
    // existe. Se siembran las dos a la vez (un precio bajo el regular con promo
    // vista y no comunicada da `promo_no_comunicada`; el sobreprecio posterior
    // deja `desviacion_precio`) para que la anulación tenga que alcanzar a ambas.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "c6", {
        precio_registrado: 5.0,
        hay_promo: true,
        promo_comunicada: false,
      });
      await pasoActualiza(c, cadena, {
        precio_registrado: 8.9,
        hay_promo: false,
        promo_comunicada: false,
      });
      expect(
        (await incidenciasDe(c, cadena.visita)).map((i) => i.origen),
      ).toEqual(["desviacion_precio", "promo_no_comunicada"]);

      await pasoActualiza(c, cadena, { precio_registrado: null });
      const incidencias = await incidenciasDe(c, cadena.visita);
      expect(incidencias.map((i) => i.estado)).toEqual(["anulada", "anulada"]);
    });
  });

  it("comunicar la promo anula la incidencia de promo sin tocar el precio", async () => {
    // El veredicto deja de ser `promo_no_comunicada` sin que el precio cambie:
    // la anulación tiene que colgar del veredicto, no de que el precio se mueva.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "c7", {
        precio_registrado: 5.0,
        hay_promo: true,
        promo_comunicada: false,
      });
      expect(
        (await incidenciasDe(c, cadena.visita)).map((i) => i.origen),
      ).toEqual(["promo_no_comunicada"]);

      await pasoActualiza(c, cadena, { promo_comunicada: true });
      const incidencias = await incidenciasDe(c, cadena.visita);
      // Sin promo vigente comunicada en el maestro, el veredicto pasa a
      // `subvaluado_sin_promo`: la de promo se anula y nace la de desviación.
      expect(incidencias.map((i) => [i.origen, i.estado])).toEqual([
        ["desviacion_precio", "pendiente"],
        ["promo_no_comunicada", "anulada"],
      ]);
    });
  });

  it("una exhibición negociada YA instalada no genera incidencia", async () => {
    // El caso negativo del motor de exhibiciones, gemelo del de SKU: sin él, un
    // motor que la creara siempre pasaría el test de "sin instalar" igual.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await abrirVisita(c, "c8");
      await c.query(
        `insert into public.exhibicion (id, levantamiento_id, exhibicion_negociada_id, instalada, completa)
         values ($1,$2,$3,true,true)`,
        [
          "e0000013-0000-0000-0000-0000000000c8",
          cadena.levantamiento,
          EXH_NEGOCIADA,
        ],
      );
      expect(await incidenciasDe(c, cadena.visita)).toEqual([]);
    });
  });

  it("instalar la exhibición anula la incidencia de exhibición", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await abrirVisita(c, "c5");
      const exhibicion = "e0000013-0000-0000-0000-0000000000c5";
      await c.query(
        `insert into public.exhibicion (id, levantamiento_id, exhibicion_negociada_id, instalada)
         values ($1,$2,$3,false)`,
        [exhibicion, cadena.levantamiento, EXH_NEGOCIADA],
      );
      await c.query(
        `update public.exhibicion set instalada = true where id = $1`,
        [exhibicion],
      );
      const incidencias = await incidenciasDe(c, cadena.visita);
      expect(incidencias.map((i) => i.estado)).toEqual(["anulada"]);
    });
  });
});

describe("la foto de resolución es de SU visita", () => {
  // La FK de `foto_resolucion_id` solo valida `(id, tenant_id)`, y la política
  // comprueba que el mercaderista es dueño de la VISITA de la incidencia — pero
  // nadie comprobaba que la foto fuese de esa visita. Con un PATCH a PostgREST
  // se podía enlazar como prueba de la resolución cualquier foto del cliente.

  /** Una foto de una visita concreta, escrita como la escribe el móvil. */
  async function fotoDe(
    c: Client,
    visita: string,
    sufijo: string,
  ): Promise<string> {
    const id = `e0000030-0000-0000-0000-0000000000${sufijo}`;
    await c.query(
      `insert into public.foto (id, visita_id, tipo, capturada_at)
       values ($1,$2,'resolucion_incidencia', now())`,
      [id, visita],
    );
    return id;
  }

  async function resolverCon(c: Client, visita: string, foto: string) {
    return c.query(
      `update public.incidencia
          set estado = 'resuelta', accion_tomada = 'Repuse el producto',
              foto_resolucion_id = $2, atendida_at = now()
        where visita_id = $1`,
      [visita, foto],
    );
  }

  it("la foto de SU visita se enlaza", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "e1", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      const foto = await fotoDe(c, cadena.visita, "e1");

      const r = await resolverCon(c, cadena.visita, foto);
      expect(r.rowCount).toBe(1);
    });
  });

  it("la foto de OTRA visita del mismo cliente NO se enlaza", async () => {
    // La amenaza concreta: mismo tenant, así que la FK la deja pasar.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "e2", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      const otra = await abrirVisita(c, "e3");
      const fotoAjena = await fotoDe(c, otra.visita, "e3");

      await expect(
        resolverCon(c, cadena.visita, fotoAjena),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("dejar la foto en null no revalida nada", async () => {
    // Atender sin foto sigue siendo posible: la obligatoriedad es de la UI, no
    // de la base — un CHECK aquí haría que cualquier PATCH parcial muriese con
    // 23514, y el conector descarta ese error en silencio.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "e4", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      const r = await c.query(
        `update public.incidencia
            set estado = 'no_resuelta', motivo = 'El encargado no autorizó',
                atendida_at = now()
          where visita_id = $1`,
        [cadena.visita],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("reenviar el mismo enlace sin cambiarlo no vuelve a validar", async () => {
    // La guarda de `tg_op`: el conector reenvía la operación completa al
    // reintentar, y sin ella cada PATCH releería `foto` sin motivo.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "e5", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      const foto = await fotoDe(c, cadena.visita, "e5");
      await resolverCon(c, cadena.visita, foto);

      const r = await c.query(
        `update public.incidencia
            set foto_resolucion_id = $2, accion_tomada = 'Repuse el producto (2)'
          where visita_id = $1`,
        [cadena.visita, foto],
      );
      expect(r.rowCount).toBe(1);
    });
  });
});

describe("incidencia — quién la lee", () => {
  it("el mercaderista lee las de SUS visitas", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      // El seed le deja un quiebre: control positivo sin sembrar nada.
      const incidencias = await incidenciasDe(c, VISITA_JOSE);
      expect(incidencias.map((i) => i.origen)).toContain("quiebre");
    });
  });

  it("el mercaderista NO lee las de un compañero de su mismo cliente", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      // El caso que el filtro por tenant NO cubre. Se siembra la visita del
      // compañero como el motor (postgres) y se vuelve a bajar a authenticated.
      const visita = "e0000020-0000-0000-0000-000000000001";
      await c.query("set local role postgres");
      await c.query(
        `insert into public.visita (id, tenant_id, rutero_parada_id, mercaderista_id, tienda_id, estado, check_in_at)
         values ($1,$2,$3,$4,$5,'en_curso', now())`,
        [visita, TENANTS.maracumango, PARADA, USUARIOS.desvinculado, TIENDA],
      );
      await c.query(
        `insert into public.incidencia (tenant_id, visita_id, origen, detalle)
         values ($1,$2,'quiebre','{}')`,
        [TENANTS.maracumango, visita],
      );
      await c.query("set local role authenticated");

      expect(await incidenciasDe(c, visita)).toEqual([]);
    });
  });

  it("el mercaderista del cliente rival no alcanza ninguna del otro", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaRival, async (c) => {
      expect(await incidenciasDe(c, VISITA_JOSE)).toEqual([]);
      // Y sí ve las suyas: sin esto, el verde sería el de una tabla vacía.
      expect(await incidenciasDe(c, VISITA_RIVAL)).not.toEqual([]);
    });
  });

  it("el supervisor y el admin leen las de su alcance", async () => {
    for (const usuario of [USUARIOS.supervisor, USUARIOS.admin]) {
      await comoUsuario(db, usuario, async (c) => {
        expect(await incidenciasDe(c, VISITA_JOSE)).not.toEqual([]);
      });
    }
  });

  it("el cliente-marca todavía no lee ninguna", async () => {
    // Deliberado: la vista del portal es de otro ticket y la abre su propia
    // rama de la política. Excluirla en la consulta que agrupa la dejaría
    // legible por PostgREST igualmente.
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      expect(await incidenciasDe(c, VISITA_JOSE)).toEqual([]);
    });
  });
});

describe("incidencia — qué puede escribir la app", () => {
  it("el mercaderista NO puede crear una incidencia", async () => {
    // Sin grant de INSERT: que las apps no las fabriquen no lo impone un
    // procedimiento, lo impone la puerta cerrada.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await expect(
        c.query(
          `insert into public.incidencia (tenant_id, visita_id, origen)
           values ($1,$2,'quiebre')`,
          [TENANTS.maracumango, VISITA_JOSE],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("el mercaderista NO puede borrar una incidencia", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await expect(
        c.query("delete from public.incidencia where visita_id = $1", [
          VISITA_JOSE,
        ]),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  // El grant es por columna: `origen`, `detalle` y `sku_id` son del servidor.
  // Una transacción POR COLUMNA: el primer 42501 aborta la transacción, y las
  // demás escrituras de la misma tanda devolverían un 25P02 que no prueba nada.
  it.each([
    ["el origen del hallazgo", "origen = 'quiebre'"],
    ["los números del detalle", "detalle = '{}'"],
    ["a qué SKU señala", "sku_id = null"],
  ])("el mercaderista NO puede reescribir %s", async (_caso, asignacion) => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      await expect(
        c.query(
          `update public.incidencia set ${asignacion} where visita_id = $1`,
          [VISITA_JOSE],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("el mercaderista resuelve su incidencia diciendo qué hizo", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "d1", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      const r = await c.query(
        `update public.incidencia
            set estado = 'resuelta', accion_tomada = 'Repuse 10 unidades',
                atendida_at = now()
          where visita_id = $1`,
        [cadena.visita],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("el mercaderista NO puede anular una incidencia", async () => {
    // `anulada` es del motor. Desde la app sería la forma de vaciar la lista
    // sin atenderla — y de rodear la verja de check-out con un PATCH.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "d2", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      await expect(
        c.query(
          `update public.incidencia set estado = 'anulada' where visita_id = $1`,
          [cadena.visita],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("resolver sin decir qué se hizo es un check violado", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "d3", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      await expect(
        c.query(
          `update public.incidencia set estado = 'resuelta', atendida_at = now()
            where visita_id = $1`,
          [cadena.visita],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("no resolver sin decir por qué es un check violado", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await levantarEnPasos(c, "d4", {
        stock_sistema: 10,
        stock_piso: 0,
      });
      await expect(
        c.query(
          `update public.incidencia set estado = 'no_resuelta', atendida_at = now()
            where visita_id = $1`,
          [cadena.visita],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("atender la incidencia de un compañero no alcanza ninguna fila", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const visita = "e0000021-0000-0000-0000-000000000001";
      await c.query("set local role postgres");
      await c.query(
        `insert into public.visita (id, tenant_id, rutero_parada_id, mercaderista_id, tienda_id, estado, check_in_at)
         values ($1,$2,$3,$4,$5,'en_curso', now())`,
        [visita, TENANTS.maracumango, PARADA, USUARIOS.desvinculado, TIENDA],
      );
      await c.query(
        `insert into public.incidencia (tenant_id, visita_id, origen, detalle)
         values ($1,$2,'quiebre','{}')`,
        [TENANTS.maracumango, visita],
      );
      await c.query("set local role authenticated");

      const r = await c.query(
        `update public.incidencia
            set estado = 'resuelta', accion_tomada = 'no es mía',
                atendida_at = now()
          where visita_id = $1`,
        [visita],
      );
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("motor de alertas — el comportamiento que no cambia", () => {
  it("la alerta se sigue produciendo UNA vez, en el INSERT", async () => {
    // `alerta` no tiene clave natural: si el motor la creara también en cada
    // UPDATE, las tres pasadas del wizard darían tres alertas del mismo quiebre.
    // Que el INSERT-only deje al motor de alertas ciego ante el stock que llega
    // por UPDATE es un defecto preexistente, y va en su propio ticket.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const cadena = await abrirVisita(c, "f1");
      await c.query(
        `insert into public.levantamiento_sku
           (id, levantamiento_id, sku_id, stock_sistema, stock_piso)
         values ($1,$2,$3,10,0)`,
        [cadena.levantamientoSku, cadena.levantamiento, SKU],
      );
      await pasoActualiza(c, cadena, { stock_sistema: 12, stock_piso: 0 });

      const r = await c.query<{ n: string }>(
        `select count(*)::text as n from public.alerta
          where visita_id = $1 and tipo = 'quiebre'`,
        [cadena.visita],
      );
      expect(r.rows[0]?.n).toBe("1");
      // Y la incidencia, que sí tiene clave natural, sigue siendo una sola.
      expect(await incidenciasDe(c, cadena.visita)).toHaveLength(1);
    });
  });
});
