// Tests de la lógica pura del pase. Corren con `deno task test` desde
// `supabase/functions` (no necesitan base ni servidor), en local y en CI.

import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";

import {
  contarPasesDeLaVentana,
  generarCodigo,
  hashCodigo,
  LIMITE_DIARIO,
  paseQueCoincide,
  type PerfilAutz,
  puedeEmitirPase,
  VENTANA_MS,
} from "./pase.ts";

const admin: PerfilAutz = { id: "admin-1", rol: "admin", supervisor_id: null };
const supervisor: PerfilAutz = {
  id: "sup-1",
  rol: "supervisor",
  supervisor_id: null,
};
const otroSupervisor: PerfilAutz = {
  id: "sup-2",
  rol: "supervisor",
  supervisor_id: null,
};
// Mercaderista que reporta a `supervisor`.
const mercaderistaDelSup: PerfilAutz = {
  id: "merc-1",
  rol: "mercaderista",
  supervisor_id: "sup-1",
};

Deno.test("generarCodigo devuelve siempre 6 dígitos", () => {
  // Muchas iteraciones: cubre el padStart cuando el número tiene menos de 6
  // dígitos (p.ej. 42 → '000042'), que es donde un código sin relleno rompería.
  for (let i = 0; i < 5_000; i++) {
    assertMatch(generarCodigo(), /^\d{6}$/);
  }
});

Deno.test("generarCodigo no se queda pegado en un solo valor", () => {
  const vistos = new Set<string>();
  for (let i = 0; i < 200; i++) vistos.add(generarCodigo());
  // Con 10^6 valores posibles, 200 tiradas casi nunca repiten; exigir variedad
  // detecta un generador degenerado (constante o de rango minúsculo).
  assert(vistos.size > 150, `poca variedad: ${vistos.size} distintos de 200`);
});

Deno.test(
  "hashCodigo es determinista para el mismo código y secreto",
  async () => {
    const a = await hashCodigo("123456", "secreto-de-prueba");
    const b = await hashCodigo("123456", "secreto-de-prueba");
    assertEquals(a, b);
  },
);

Deno.test(
  "hashCodigo devuelve 64 hex (SHA-256) y nunca el código en claro",
  async () => {
    const h = await hashCodigo("000042", "secreto-de-prueba");
    assertMatch(h, /^[0-9a-f]{64}$/);
    assert(!h.includes("000042"));
  },
);

Deno.test("hashCodigo cambia con el código y con el secreto", async () => {
  const base = await hashCodigo("123456", "secreto-de-prueba");
  assert((await hashCodigo("123457", "secreto-de-prueba")) !== base);
  assert((await hashCodigo("123456", "otro-secreto")) !== base);
});

Deno.test("puedeEmitirPase: admin emite a cualquier mercaderista", () => {
  assertEquals(puedeEmitirPase(admin, mercaderistaDelSup), { permitido: true });
});

Deno.test("puedeEmitirPase: admin no emite a un no-mercaderista (403)", () => {
  const d = puedeEmitirPase(admin, otroSupervisor);
  assertEquals(d.permitido, false);
  assert(!d.permitido && d.status === 403);
});

Deno.test("puedeEmitirPase: admin y objetivo inexistente → 404", () => {
  const d = puedeEmitirPase(admin, null);
  assertEquals(d.permitido, false);
  assert(!d.permitido && d.status === 404);
});

Deno.test("puedeEmitirPase: supervisor emite a un mercaderista suyo", () => {
  assertEquals(puedeEmitirPase(supervisor, mercaderistaDelSup), {
    permitido: true,
  });
});

Deno.test(
  "puedeEmitirPase: supervisor no emite al mercaderista de otro (403)",
  () => {
    const d = puedeEmitirPase(otroSupervisor, mercaderistaDelSup);
    assert(!d.permitido && d.status === 403);
  },
);

Deno.test(
  "puedeEmitirPase: para el supervisor, inexistente y no-suyo dan la MISMA respuesta (no filtra existencia)",
  () => {
    // Un profile_id de otro tenant se ve igual exista o no: sin sonda de existencia.
    const inexistente = puedeEmitirPase(supervisor, null);
    const noSuyo = puedeEmitirPase(supervisor, {
      id: "merc-9",
      rol: "mercaderista",
      supervisor_id: "sup-2",
    });
    assertEquals(inexistente, noSuyo);
    assert(!inexistente.permitido && inexistente.status === 403);
  },
);

Deno.test(
  "puedeEmitirPase: un no-staff (mercaderista/cliente) nunca emite",
  () => {
    const merc: PerfilAutz = {
      id: "merc-1",
      rol: "mercaderista",
      supervisor_id: "sup-1",
    };
    const cliente: PerfilAutz = {
      id: "cli-1",
      rol: "cliente",
      supervisor_id: null,
    };
    assert(!puedeEmitirPase(merc, mercaderistaDelSup).permitido);
    assert(!puedeEmitirPase(cliente, mercaderistaDelSup).permitido);
  },
);

Deno.test(
  "paseQueCoincide: devuelve el que coincide y null si ninguno",
  async () => {
    const secreto = "secreto-de-prueba";
    const candidatos = [
      { id: "p1", codigo_hash: await hashCodigo("111111", secreto) },
      { id: "p2", codigo_hash: await hashCodigo("222222", secreto) },
    ];
    assertEquals(
      paseQueCoincide(await hashCodigo("222222", secreto), candidatos)?.id,
      "p2",
    );
    assertEquals(
      paseQueCoincide(await hashCodigo("333333", secreto), candidatos),
      null,
    );
    assertEquals(
      paseQueCoincide(await hashCodigo("111111", secreto), []),
      null,
    );
  },
);

// --- La cota antiabuso --------------------------------------------------------
//
// El doble guarda FILAS y APLICA los filtros, en vez de devolver un número fijo.
// No es ceremonia: el fallo que estos tests fijan era que la consulta filtraba
// por `revocado_at is null`, y un doble que ignorase los filtros daría el mismo
// verde con la consulta correcta y con la rota.

type FilaPase = {
  profile_id: string;
  generado_at: string;
  revocado_at: string | null;
};

function clienteConPases(filas: FilaPase[]) {
  const filtros: ((f: FilaPase) => boolean)[] = [];
  const consulta = {
    eq: (columna: string, valor: string) => {
      filtros.push((f) => f[columna as keyof FilaPase] === valor);
      return consulta;
    },
    is: (columna: string, valor: null) => {
      filtros.push((f) => f[columna as keyof FilaPase] === valor);
      return consulta;
    },
    // Comparación de STRINGS, y solo vale porque todo lo que se compara aquí
    // sale de `toISOString()`: ancho fijo, con relleno de ceros, en UTC y con
    // `Z`. En ese formato el orden lexicográfico y el cronológico coinciden.
    // Postgres compara `timestamptz` de verdad; el día que un fixture use otra
    // representación válida (offset `+00:00`, microsegundos) el doble mentiría
    // sin avisar.
    gte: (columna: string, valor: string) => {
      filtros.push((f) => String(f[columna as keyof FilaPase]) >= valor);
      return consulta;
    },
    abortSignal: (_senal: AbortSignal) =>
      Promise.resolve({
        count: filas.filter((f) => filtros.every((pasa) => pasa(f))).length,
        error: null,
      }),
  };
  return {
    from: () => ({ select: () => consulta }),
  };
}

const AYER = new Date(Date.now() - VENTANA_MS).toISOString();
const HACE_UNA_HORA = new Date(Date.now() - 3_600_000).toISOString();
const HACE_DOS_DIAS = new Date(Date.now() - 2 * VENTANA_MS).toISOString();

function pase(over: Partial<FilaPase> = {}): FilaPase {
  return {
    profile_id: "merc-1",
    generado_at: HACE_UNA_HORA,
    revocado_at: null,
    ...over,
  };
}

Deno.test("revocar un pase NO libera cupo del tope diario", async () => {
  // El criterio del ticket. Se emitieron tres —el tope— y se revocó uno: el
  // cuarto no cabe. Contar solo los vivos convertía el límite en orientativo:
  // emites tres, revocas dos y emites dos más.
  const filas = [pase(), pase(), pase({ revocado_at: HACE_UNA_HORA })];

  const { count } = await contarPasesDeLaVentana(
    clienteConPases(filas),
    "merc-1",
    AYER,
    AbortSignal.timeout(1_000),
  );

  assertEquals(count, 3);
  assert((count ?? 0) >= LIMITE_DIARIO, "el tope tiene que seguir alcanzado");
});

// Los dos tests que siguen NO son secundarios: son la GUARDIA DEL DOBLE.
//
// El caso del criterio pasa aunque el doble ignore los filtros —tres filas dan
// tres de todas formas—, así que por sí solo no demostraría nada. Estos dos
// esperan un conteo MENOR que el total, y por eso caen en cuanto el doble deja
// de filtrar. Comprobado a la fuerza con un doble ciego: el del criterio sigue
// verde y estos dos se ponen rojos.
Deno.test("el tope es por usuario, no global", async () => {
  const filas = [pase(), pase(), pase({ profile_id: "merc-2" })];

  const { count } = await contarPasesDeLaVentana(
    clienteConPases(filas),
    "merc-1",
    AYER,
    AbortSignal.timeout(1_000),
  );

  assertEquals(count, 2);
});

Deno.test("los pases de fuera de la ventana no cuentan", async () => {
  // Sin esta cota, el tope sería para siempre en vez de diario.
  const filas = [pase(), pase({ generado_at: HACE_DOS_DIAS })];

  const { count } = await contarPasesDeLaVentana(
    clienteConPases(filas),
    "merc-1",
    AYER,
    AbortSignal.timeout(1_000),
  );

  assertEquals(count, 1);
});

Deno.test("sin pases previos el cupo está libre", async () => {
  const { count } = await contarPasesDeLaVentana(
    clienteConPases([]),
    "merc-1",
    AYER,
    AbortSignal.timeout(1_000),
  );

  assertEquals(count, 0);
  assert((count ?? 0) < LIMITE_DIARIO);
});
