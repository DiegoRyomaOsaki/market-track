// Tests de la lógica pura del pase. Corren con `deno task test` desde
// `supabase/functions` (no necesitan base ni servidor), en local y en CI.

import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";

import {
  generarCodigo,
  hashCodigo,
  paseQueCoincide,
  type PerfilAutz,
  puedeEmitirPase,
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
