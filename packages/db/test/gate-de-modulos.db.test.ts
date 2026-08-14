import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comoUsuario, conectar, TENANTS, USUARIOS } from "./ayudas";

// El gate de módulos del portal LLEGA A LAS RPC: apagar una sección para un
// cliente tiene que apagar también sus datos, no solo su página. La página hace
// `notFound()` (UX), pero la RPC es alcanzable directamente por PostgREST con la
// anon key y el JWT del cliente — la verja de datos es `app.modulo_habilitado()`
// dentro de cada función de sección.
//
// El contrato es UNO para todas: módulo apagado => resultado VACÍO (cero filas,
// null o el árbol vacío, según la forma de cada función). Por eso el test es una
// TABLA sobre las nueve RPC y no un caso por archivo: si una función nueva de
// sección no entra aquí, o una existente cambia de mecanismo, se nota.
//
// La ventana de fechas es ancha a propósito (cubre el seed entero): si la verja
// no corta, las filas del seed salen y el test se pone rojo.

const DESDE = "2000-01-01";
const HASTA = "2099-12-31";
// Una alerta que EXISTE de verdad en el seed (de Maracumango, con visita). Un id
// inventado demostraría "no existe", no "el módulo está apagado" — el mismo
// principio que el harness de alertas aplica al aislamiento entre tenants.
const ALERTA_MARACUMANGO = "a0000016-0000-0000-0000-000000000001";

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

/**
 * Apaga un módulo para un tenant como lo haría el admin (upsert del panel),
 * pero con el rol de la base para no depender de la sesión suplantada. Corre
 * dentro de la transacción con rollback de `comoUsuario`: no ensucia el seed.
 */
async function apagarModulo(
  c: Client,
  modulo: string,
  tenantId: string = TENANTS.maracumango,
): Promise<void> {
  await c.query("set local role postgres");
  await c.query(
    `insert into public.portal_modulo_habilitado (tenant_id, modulo, habilitado)
     values ($1, $2::public.modulo_portal, false)
     on conflict (tenant_id, modulo) do update set habilitado = false`,
    [tenantId, modulo],
  );
  await c.query("set local role authenticated");
}

/**
 * Una RPC de sección: a qué módulo pertenece, qué es "vacío" para su forma y
 * qué señal DETERMINISTA (independiente de cuántos datos haya) demuestra que
 * sigue viva. Sin `esperaVivo`, el caso "vacío" podría pasar por casualidad —
 * una verja atada al módulo equivocado también daría vacío.
 */
type RpcDeSeccion = {
  modulo: string;
  nombre: string;
  esperaVacio: (c: Client) => Promise<void>;
  /** Ausente solo cuando el vacío es también el resultado normal sin datos
   * (perfect_store_desglose): ahí la familia la cubren sus hermanas. */
  esperaVivo?: (c: Client) => Promise<void>;
};

async function esperaCeroFilas(c: Client, sql: string): Promise<void> {
  const r = await c.query(sql);
  expect(r.rowCount).toBe(0);
}

async function esperaFilas(c: Client, sql: string): Promise<void> {
  const r = await c.query(sql);
  expect(r.rowCount).toBeGreaterThan(0);
}

const RPCS: RpcDeSeccion[] = [
  {
    modulo: "dashboard",
    nombre: "dashboard_kpis",
    // Sin verja, los agregados devuelven SIEMPRE una fila (aunque sea de ceros):
    // cero filas solo puede significar que la verja cortó.
    esperaVacio: (c) =>
      esperaCeroFilas(
        c,
        `select * from public.dashboard_kpis('${DESDE}', '${HASTA}')`,
      ),
    esperaVivo: (c) =>
      esperaFilas(
        c,
        `select * from public.dashboard_kpis('${DESDE}', '${HASTA}')`,
      ),
  },
  {
    modulo: "mapa",
    nombre: "dashboard_pines",
    esperaVacio: (c) =>
      esperaCeroFilas(
        c,
        `select * from public.dashboard_pines('${DESDE}', '${HASTA}')`,
      ),
    // El seed tiene una tienda de Maracumango con ubicación (lat/lon generadas).
    esperaVivo: (c) =>
      esperaFilas(
        c,
        `select * from public.dashboard_pines('${DESDE}', '${HASTA}')`,
      ),
  },
  {
    modulo: "dashboard",
    nombre: "dashboard_alertas",
    esperaVacio: (c) =>
      esperaCeroFilas(
        c,
        `select * from public.dashboard_alertas('${DESDE}', '${HASTA}')`,
      ),
    // El seed tiene una alerta de Maracumango con creado_at = now(), dentro de
    // la ventana ancha.
    esperaVivo: (c) =>
      esperaFilas(
        c,
        `select * from public.dashboard_alertas('${DESDE}', '${HASTA}')`,
      ),
  },
  {
    modulo: "alertas",
    nombre: "bandeja_alertas",
    esperaVacio: (c) =>
      esperaCeroFilas(
        c,
        `select * from public.bandeja_alertas('${DESDE}', '${HASTA}')`,
      ),
    esperaVivo: (c) =>
      esperaFilas(
        c,
        `select * from public.bandeja_alertas('${DESDE}', '${HASTA}')`,
      ),
  },
  {
    modulo: "alertas",
    nombre: "detalle_alerta",
    esperaVacio: async (c) => {
      // Sobre una alerta que EXISTE: el mismo null indistinguible de "no
      // existe o no es del tenant" — la verja no confirma que la alerta exista.
      const r = await c.query<{ d: unknown }>(
        `select public.detalle_alerta($1) as d`,
        [ALERTA_MARACUMANGO],
      );
      expect(r.rows[0]?.d).toBeNull();
    },
    esperaVivo: async (c) => {
      const r = await c.query<{ d: unknown }>(
        `select public.detalle_alerta($1) as d`,
        [ALERTA_MARACUMANGO],
      );
      expect(r.rows[0]?.d).not.toBeNull();
    },
  },
  {
    modulo: "galeria",
    nombre: "galeria_evidencia",
    esperaVacio: async (c) => {
      // El árbol vacío BIEN FORMADO, no null: la misma forma que "no hubo
      // visitas", que el schema Zod del portal ya parsea.
      const r = await c.query<{ g: unknown }>(
        `select public.galeria_evidencia('${DESDE}', '${HASTA}') as g`,
      );
      expect(r.rows[0]?.g).toEqual({
        visitas_totales: 0,
        truncado: false,
        tiendas: [],
      });
    },
    // El seed tiene una visita de Maracumango con check_in_at = now().
    esperaVivo: async (c) => {
      const r = await c.query<{ g: { visitas_totales: number } }>(
        `select public.galeria_evidencia('${DESDE}', '${HASTA}') as g`,
      );
      expect(r.rows[0]?.g.visitas_totales).toBeGreaterThan(0);
    },
  },
  {
    modulo: "perfect_store",
    nombre: "perfect_store_agregado",
    // La verja va en HAVING: un agregado sin group by devolvería una fila de
    // count=0 y nulos si la verja fuera un WHERE. Cero filas lo pinna.
    esperaVacio: (c) =>
      esperaCeroFilas(
        c,
        `select * from public.perfect_store_agregado('${DESDE}', '${HASTA}')`,
      ),
    esperaVivo: (c) =>
      esperaFilas(
        c,
        `select * from public.perfect_store_agregado('${DESDE}', '${HASTA}')`,
      ),
  },
  {
    modulo: "perfect_store",
    nombre: "perfect_store_serie",
    // Ni siquiera los buckets vacíos: cero filas, no una serie de huecos.
    esperaVacio: (c) =>
      esperaCeroFilas(
        c,
        `select * from public.perfect_store_serie('${DESDE}', '${HASTA}', 'mes')`,
      ),
    // La serie devuelve sus buckets haya o no datos: señal viva sin seed.
    esperaVivo: (c) =>
      esperaFilas(
        c,
        `select * from public.perfect_store_serie('${DESDE}', '${HASTA}', 'mes')`,
      ),
  },
  {
    modulo: "perfect_store",
    nombre: "perfect_store_desglose",
    esperaVacio: (c) =>
      esperaCeroFilas(
        c,
        `select * from public.perfect_store_desglose('${DESDE}', '${HASTA}', 'tienda')`,
      ),
    // Sin `esperaVivo`: sin filas de puntaje sembradas, el desglose devuelve
    // cero grupos también con el módulo encendido — un "vivo" aquí sería
    // indistinguible del vacío. Su verja usa el mismo literal que sus hermanas
    // agregado y serie, que sí tienen señal viva determinista.
  },
];

describe("gate de módulos — las RPC de sección con el módulo apagado", () => {
  for (const rpc of RPCS) {
    it(`${rpc.nombre} con el módulo ${rpc.modulo} apagado no devuelve datos`, async () => {
      await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
        await apagarModulo(c, rpc.modulo);
        await rpc.esperaVacio(c);
      });
    });
  }

  // Si una RPC comprobara el módulo equivocado (o "cualquier módulo apagado"),
  // su caso de vacío de arriba podría pasar por casualidad; esto lo descarta
  // RPC por RPC: con OTRO módulo apagado, cada una sigue devolviendo su señal
  // viva determinista.
  for (const rpc of RPCS) {
    if (!rpc.esperaVivo) continue;
    const vivo = rpc.esperaVivo;
    const otro = rpc.modulo === "galeria" ? "mapa" : "galeria";
    it(`${rpc.nombre} sigue vivo con el módulo ${otro} apagado: su verja es la de ${rpc.modulo}`, async () => {
      await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
        await apagarModulo(c, otro);
        await vivo(c);
      });
    });
  }

  it("cada módulo del enum tiene sus RPC en esta tabla — salvo reportes, que no tiene RPC", async () => {
    // `reportes` es hoy una página placeholder sin función que gatear. Este
    // assert es el tripwire: quien añada un valor al enum (como pasó con
    // perfect_store) o construya la exportación de reportes tiene que decidir
    // aquí qué RPC lleva la verja.
    const r = await db.query<{ modulo: string }>(
      `select unnest(enum_range(null::public.modulo_portal))::text as modulo`,
    );
    const delEnum = r.rows.map((x) => x.modulo).sort();
    const conRpc = [...new Set(RPCS.map((x) => x.modulo))].sort();
    expect(delEnum).toEqual(
      [
        "dashboard",
        "mapa",
        "galeria",
        "alertas",
        "reportes",
        "perfect_store",
      ].sort(),
    );
    expect(conRpc).toEqual(delEnum.filter((m) => m !== "reportes"));
  });
});

describe("gate de módulos — a quién NO corta", () => {
  it("el staff no está gateado: el módulo es contrato del cliente, no del supervisor", async () => {
    // tenant_actual() es NULL para el staff, así que ningún override lo alcanza:
    // la misma regla que portal_modulos() documenta desde su creación.
    await comoUsuario(db, USUARIOS.supervisor, async (c) => {
      await apagarModulo(c, "dashboard");
      const r = await c.query(
        `select * from public.dashboard_kpis('${DESDE}', '${HASTA}')`,
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("el override de un tenant no corta al otro", async () => {
    await comoUsuario(db, USUARIOS.clienteMaracumango, async (c) => {
      await apagarModulo(c, "dashboard", TENANTS.rival);
      const r = await c.query(
        `select * from public.dashboard_kpis('${DESDE}', '${HASTA}')`,
      );
      expect(r.rowCount).toBe(1);
    });
  });
});

describe("gate de módulos — el contrato de la verja", () => {
  it("authenticated puede ejecutar app.modulo_habilitado; anon no", async () => {
    // Las nueve RPC son security invoker: sin este EXECUTE, el portal entero
    // muere con 42501 para todos los roles. Es el fallo de mayor radio.
    const r = await db.query<{ auth: boolean; anon: boolean }>(
      `select has_function_privilege('authenticated', 'app.modulo_habilitado(public.modulo_portal)', 'EXECUTE') as auth,
              has_function_privilege('anon', 'app.modulo_habilitado(public.modulo_portal)', 'EXECUTE') as anon`,
    );
    expect(r.rows[0]?.auth).toBe(true);
    expect(r.rows[0]?.anon).toBe(false);
  });

  it("las tres funciones del dashboard conservan su search_path fijado", async () => {
    // `create or replace` BORRA el `set search_path` que el endurecimiento les
    // puso con `alter function`. Quien recree estas funciones (p. ej. para
    // tocar sus ventanas de fecha) tiene que re-declararlo en el propio texto —
    // este test lo hace visible.
    const r = await db.query<{ proname: string; proconfig: string[] | null }>(
      `select proname, proconfig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and proname in ('dashboard_kpis', 'dashboard_pines', 'dashboard_alertas')
       order by proname`,
    );
    expect(r.rows).toHaveLength(3);
    for (const fila of r.rows) {
      expect(
        fila.proconfig?.some((c) => c.startsWith("search_path=")),
        `${fila.proname} sin search_path fijado`,
      ).toBe(true);
    }
  });
});
