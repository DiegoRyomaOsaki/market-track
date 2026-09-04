import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// `levantamiento_paso`: el módulo que el mercaderista dio por terminado.
//
// Es la mitad que faltaba del avance del wizard —`contingencia` ya registraba
// los que NO pudo terminar— y la que permite saltar de módulo sin perder el
// progreso. Se escribe desde el teléfono por PostgREST, así que pasa por RLS.
//
// Cada test monta una cadena fresca dentro de la transacción con rollback de
// `comoUsuario`, y las aserciones se acotan al levantamiento que el propio test
// sembró: un `count(*)` sobre la tabla entera se rompe con la fila de otra
// sesión, o pasa en verde tapando un fallo real.

const PARADA = "a0000009-0000-0000-0000-000000000001";
const TIENDA = "a0000002-0000-0000-0000-000000000001";
const MARCA = "cccccccc-0000-0000-0000-000000000001";

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

/** Abre una visita y su levantamiento como el mercaderista dueño. */
async function abrirLevantamiento(c: Client, sufijo: string): Promise<string> {
  const visita = `f0000010-0000-0000-0000-0000000000${sufijo}`;
  const lev = `f0000011-0000-0000-0000-0000000000${sufijo}`;
  await c.query(
    `insert into public.visita (id, rutero_parada_id, mercaderista_id, tienda_id, estado, check_in_at)
     values ($1,$2,$3,$4,'en_curso', now())`,
    [visita, PARADA, USUARIOS.mercaderistaMaracumango, TIENDA],
  );
  await c.query(
    `insert into public.levantamiento (id, visita_id, marca_id) values ($1,$2,$3)`,
    [lev, visita, MARCA],
  );
  return lev;
}

async function modulosDe(c: Client, levantamiento: string) {
  const r = await c.query<{ paso: string; paso_config_id: string | null }>(
    `select paso, paso_config_id from public.levantamiento_paso
      where levantamiento_id = $1 order by paso`,
    [levantamiento],
  );
  return r.rows;
}

describe("levantamiento_paso — el mercaderista cierra sus módulos", () => {
  it("el dueño de la visita marca un módulo fijo como terminado", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const lev = await abrirLevantamiento(c, "a1");
      await c.query(
        `insert into public.levantamiento_paso (tenant_id, levantamiento_id, paso, completado_at)
         values ($1,$2,'quiebres', now())`,
        [TENANTS.maracumango, lev],
      );
      expect(await modulosDe(c, lev)).toEqual([
        { paso: "quiebres", paso_config_id: null },
      ]);
    });
  });

  it("un módulo configurable se identifica por su paso_config_id", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const lev = await abrirLevantamiento(c, "a2");
      await c.query(
        `insert into public.levantamiento_paso (tenant_id, levantamiento_id, paso, paso_config_id, completado_at)
         values ($1,$2,'campos_extra','extra_uno', now())`,
        [TENANTS.maracumango, lev],
      );
      expect(await modulosDe(c, lev)).toEqual([
        { paso: "campos_extra", paso_config_id: "extra_uno" },
      ]);
    });
  });

  it("dos módulos configurables distintos conviven en el mismo levantamiento", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const lev = await abrirLevantamiento(c, "a3");
      await c.query(
        `insert into public.levantamiento_paso (tenant_id, levantamiento_id, paso, paso_config_id, completado_at)
         values ($1,$2,'campos_extra','extra_uno', now()), ($1,$2,'campos_extra','extra_dos', now())`,
        [TENANTS.maracumango, lev],
      );
      expect((await modulosDe(c, lev)).map((m) => m.paso_config_id)).toEqual([
        "extra_uno",
        "extra_dos",
      ]);
    });
  });
});

describe("levantamiento_paso — un módulo, una fila", () => {
  // El unique de tres columnas NO serviría: `paso_config_id` es nullable y en
  // SQL un NULL nunca choca con otro NULL, así que dejaría entrar dos filas del
  // mismo paso fijo. Por eso son dos índices parciales, y por eso hacen falta
  // los dos tests.
  it("el mismo módulo FIJO no se puede marcar dos veces", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const lev = await abrirLevantamiento(c, "b1");
      await c.query(
        `insert into public.levantamiento_paso (tenant_id, levantamiento_id, paso, completado_at)
         values ($1,$2,'quiebres', now())`,
        [TENANTS.maracumango, lev],
      );
      await expect(
        c.query(
          `insert into public.levantamiento_paso (tenant_id, levantamiento_id, paso, completado_at)
           values ($1,$2,'quiebres', now())`,
          [TENANTS.maracumango, lev],
        ),
      ).rejects.toMatchObject({ code: "23505" });
    });
  });

  it("el mismo módulo CONFIGURABLE no se puede marcar dos veces", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const lev = await abrirLevantamiento(c, "b2");
      await c.query(
        `insert into public.levantamiento_paso (tenant_id, levantamiento_id, paso, paso_config_id, completado_at)
         values ($1,$2,'campos_extra','extra_uno', now())`,
        [TENANTS.maracumango, lev],
      );
      await expect(
        c.query(
          `insert into public.levantamiento_paso (tenant_id, levantamiento_id, paso, paso_config_id, completado_at)
           values ($1,$2,'campos_extra','extra_uno', now())`,
          [TENANTS.maracumango, lev],
        ),
      ).rejects.toMatchObject({ code: "23505" });
    });
  });

  it("el reintento de PowerSync (upsert) no duplica ni falla", async () => {
    // El conector reenvía la operación como `on conflict do update` cuando la
    // primera no confirmó. Sin el grant de UPDATE moriría con 42501, y el
    // conector clasifica ese error como permanente y DESCARTA la operación.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const lev = await abrirLevantamiento(c, "b3");
      const id = "f0000012-0000-0000-0000-0000000000b3";
      for (let intento = 0; intento < 2; intento++) {
        await c.query(
          `insert into public.levantamiento_paso (id, tenant_id, levantamiento_id, paso, completado_at)
           values ($1,$2,$3,'quiebres', now())
           on conflict (id) do update set completado_at = excluded.completado_at`,
          [id, TENANTS.maracumango, lev],
        );
      }
      expect(await modulosDe(c, lev)).toHaveLength(1);
    });
  });
});

describe("levantamiento_paso — quién puede leer y escribir", () => {
  it("el mercaderista NO puede cerrar un módulo del levantamiento de otro", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const visita = "f0000020-0000-0000-0000-000000000001";
      const lev = "f0000021-0000-0000-0000-000000000001";
      await c.query("set local role postgres");
      await c.query(
        `insert into public.visita (id, tenant_id, rutero_parada_id, mercaderista_id, tienda_id, estado, check_in_at)
         values ($1,$2,$3,$4,$5,'en_curso', now())`,
        [visita, TENANTS.maracumango, PARADA, USUARIOS.desvinculado, TIENDA],
      );
      await c.query(
        `insert into public.levantamiento (id, tenant_id, visita_id, marca_id)
         values ($1,$2,$3,$4)`,
        [lev, TENANTS.maracumango, visita, MARCA],
      );
      await c.query("set local role authenticated");

      await expect(
        c.query(
          `insert into public.levantamiento_paso (tenant_id, levantamiento_id, paso, completado_at)
           values ($1,$2,'quiebres', now())`,
          [TENANTS.maracumango, lev],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("el mercaderista NO lee los módulos cerrados de un compañero", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const visita = "f0000022-0000-0000-0000-000000000001";
      const lev = "f0000023-0000-0000-0000-000000000001";
      await c.query("set local role postgres");
      await c.query(
        `insert into public.visita (id, tenant_id, rutero_parada_id, mercaderista_id, tienda_id, estado, check_in_at)
         values ($1,$2,$3,$4,$5,'en_curso', now())`,
        [visita, TENANTS.maracumango, PARADA, USUARIOS.desvinculado, TIENDA],
      );
      await c.query(
        `insert into public.levantamiento (id, tenant_id, visita_id, marca_id)
         values ($1,$2,$3,$4)`,
        [lev, TENANTS.maracumango, visita, MARCA],
      );
      await c.query(
        `insert into public.levantamiento_paso (tenant_id, levantamiento_id, paso, completado_at)
         values ($1,$2,'quiebres', now())`,
        [TENANTS.maracumango, lev],
      );
      await c.query("set local role authenticated");

      expect(await modulosDe(c, lev)).toEqual([]);
    });
  });

  it("el mercaderista del cliente rival no alcanza nada del otro", async () => {
    // Sembrado y lectura en la MISMA transacción: `comoUsuario` revierte al
    // salir, así que sembrar en un bloque y leer en otro daría un verde
    // trivial —no hay nada que leer— con la política rota o sin ella.
    await comoUsuario(db, USUARIOS.mercaderistaRival, async (c) => {
      const visita = "f0000024-0000-0000-0000-000000000001";
      const lev = "f0000025-0000-0000-0000-000000000001";
      await c.query("set local role postgres");
      await c.query(
        `insert into public.visita (id, tenant_id, rutero_parada_id, mercaderista_id, tienda_id, estado, check_in_at)
         values ($1,$2,$3,$4,$5,'en_curso', now())`,
        [
          visita,
          TENANTS.maracumango,
          PARADA,
          USUARIOS.mercaderistaMaracumango,
          TIENDA,
        ],
      );
      await c.query(
        `insert into public.levantamiento (id, tenant_id, visita_id, marca_id)
         values ($1,$2,$3,$4)`,
        [lev, TENANTS.maracumango, visita, MARCA],
      );
      await c.query(
        `insert into public.levantamiento_paso (tenant_id, levantamiento_id, paso, completado_at)
         values ($1,$2,'quiebres', now())`,
        [TENANTS.maracumango, lev],
      );
      // Control positivo: como postgres la fila SÍ está. Sin esto, el `[]` de
      // abajo sería cierto aunque el sembrado hubiese fallado en silencio.
      expect(await modulosDe(c, lev)).toHaveLength(1);

      await c.query("set local role authenticated");
      expect(await modulosDe(c, lev)).toEqual([]);
    });
  });

  it("el staff lee los módulos cerrados de su alcance", async () => {
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const lev = await abrirLevantamiento(c, "c2");
      await c.query(
        `insert into public.levantamiento_paso (tenant_id, levantamiento_id, paso, completado_at)
         values ($1,$2,'quiebres', now())`,
        [TENANTS.maracumango, lev],
      );
      await c.query("set local role postgres");
      await c.query(
        `set local request.jwt.claims = '${JSON.stringify({
          sub: USUARIOS.supervisor,
          role: "authenticated",
          aal: "aal2",
        })}'`,
      );
      await c.query("set local role authenticated");
      expect(await modulosDe(c, lev)).toHaveLength(1);
    });
  });

  it("un módulo cerrado NO se puede borrar desde la app", async () => {
    // Sin grant de DELETE: un módulo terminado no se desmarca desde el cliente.
    await comoUsuario(db, USUARIOS.mercaderistaMaracumango, async (c) => {
      const lev = await abrirLevantamiento(c, "c3");
      await c.query(
        `insert into public.levantamiento_paso (tenant_id, levantamiento_id, paso, completado_at)
         values ($1,$2,'quiebres', now())`,
        [TENANTS.maracumango, lev],
      );
      await expect(
        c.query(
          `delete from public.levantamiento_paso where levantamiento_id = $1`,
          [lev],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
});
