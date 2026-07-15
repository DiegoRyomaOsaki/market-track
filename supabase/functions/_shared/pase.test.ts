// Tests de la lógica pura del pase. Corren con `deno test supabase/functions`
// (no necesitan base ni servidor). Cablearlos a CI es MAR-65.

import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";

import { generarCodigo, hashCodigo } from "./pase.ts";

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
