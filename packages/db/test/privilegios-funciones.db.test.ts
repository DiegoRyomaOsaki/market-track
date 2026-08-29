import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { conectar } from "./ayudas";

// El contrato de privilegios de las funciones de `public`.
//
// Postgres concede EXECUTE a PUBLIC al crear una función, y PUBLIC incluye a
// `anon` —el rol de una petición SIN sesión—. Ese privilegio aparece solo: no
// está escrito en ninguna migración, así que no se ve leyendo el diff que crea
// la función. Solo se ve preguntándole al catálogo, que es lo que hace esto.
//
// OJO CON LO QUE ESTE ARCHIVO NO PUEDE VER: corre contra el Postgres local, y
// los dos entornos conceden por caminos DISTINTOS — en local el default de
// Postgres (EXECUTE a PUBLIC, que `anon` hereda) y en la nube un default
// privilege de Supabase que estampa un grant explícito `anon=X`. Una migración
// que revoque solo de `public` deja el agujero abierto en la nube Y PASA ESTE
// TEST EN VERDE. Por eso la migración revoca de los dos, y por eso el contrato
// de la nube se comprueba contra la nube (advisors), no aquí.
//
// Ninguna de estas funciones era explotable: las que autorizan abren con un
// guardia de staff, y las de trigger mueren si se las llama por RPC. Lo que se
// fija aquí es que la puerta no sea más ancha que lo que hace falta.

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

type FilaPrivilegio = { funcion: string; puede: boolean };

/** Qué funciones de `public` puede ejecutar un rol, preguntado al catálogo. */
async function alcanzablesPor(
  rol: string,
  filtro: { soloSecurityDefiner: boolean },
): Promise<string[]> {
  const r = await db.query<{ funcion: string }>(
    `select p.oid::regprocedure::text as funcion
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and ($2 is false or p.prosecdef)
       and has_function_privilege($1, p.oid, 'execute')
     order by 1`,
    [rol, filtro.soloSecurityDefiner],
  );
  return r.rows.map((x) => x.funcion);
}

describe("`anon` y las funciones de public", () => {
  it("no alcanza NINGUNA función SECURITY DEFINER", async () => {
    // La aserción es "ninguna", no una lista de las tres que se arreglaron: es
    // lo que caza la cuarta que alguien cree mañana sin revocar el default.
    // Una SECURITY DEFINER corre con los privilegios de su dueño, así que es la
    // que de verdad importa que no quede al alcance de una petición sin sesión.
    expect(await alcanzablesPor("anon", { soloSecurityDefiner: true })).toEqual(
      [],
    );
  });

  it("tampoco alcanza las funciones de trigger", async () => {
    // Llamarlas por RPC muere igual ("trigger functions can only be called as
    // triggers"), pero el trigger dispara con los privilegios de la TABLA: el
    // EXECUTE no le hace falta a nadie y por eso sobra.
    const deTrigger = await db.query<FilaPrivilegio>(
      `select p.oid::regprocedure::text as funcion,
              has_function_privilege('anon', p.oid, 'execute') as puede
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.prorettype = 'trigger'::regtype
       order by 1`,
    );

    expect(deTrigger.rows.length).toBeGreaterThan(0);
    expect(deTrigger.rows.filter((f) => f.puede)).toEqual([]);
  });

  it("las cuatro del caso conocido siguen fuera de su alcance", async () => {
    // Fijadas por nombre a propósito, además del barrido de arriba: si alguien
    // recrea una de ellas sin revocar, el barrido lo dice pero no dice CUÁL era
    // el caso conocido.
    const r = await db.query<FilaPrivilegio>(
      `select f.funcion, has_function_privilege('anon', f.funcion, 'execute') as puede
       from (values
         ('public.fijar_hora_parada(uuid, time)'),
         ('public.recalcular_puntaje_merchandiser(public.periodo_puntaje, date, uuid, uuid)'),
         ('public.parada_solo_se_planifica_en_borrador()'),
         ('public.marcar_desactivacion()')
       ) as f(funcion)`,
    );

    expect(r.rows).toHaveLength(4);
    expect(r.rows.filter((x) => x.puede)).toEqual([]);
  });

  it("`authenticated` conserva las RPC que sí necesita", async () => {
    // La otra mitad del arreglo: revocar de más rompería el panel en silencio.
    // Un `revoke … from public` se lleva por delante lo que `authenticated`
    // heredaba, así que estas dos llevan su `grant` explícito detrás.
    const r = await db.query<FilaPrivilegio>(
      `select f.funcion, has_function_privilege('authenticated', f.funcion, 'execute') as puede
       from (values
         ('public.fijar_hora_parada(uuid, time)'),
         ('public.recalcular_puntaje_merchandiser(public.periodo_puntaje, date, uuid, uuid)')
       ) as f(funcion)`,
    );

    expect(r.rows).toHaveLength(2);
    expect(r.rows.filter((x) => !x.puede)).toEqual([]);
  });
});
