// Tests de los ayudantes de secretos. Corren con
// `deno test supabase/functions` (sin base ni servidor).

import { assert } from "jsr:@std/assert@1";

import { esBase64Estandar, igualesEnTiempoConstante } from "./secreto.ts";

Deno.test(
  "igualesEnTiempoConstante: iguales, distintos, y de largos distintos",
  () => {
    assert(igualesEnTiempoConstante("abc", "abc"));
    assert(!igualesEnTiempoConstante("abc", "abd"));
    assert(!igualesEnTiempoConstante("abc", "ab"));
    assert(!igualesEnTiempoConstante("", "a"));
    assert(igualesEnTiempoConstante("", ""));
    // Con bytes multibyte también: se compara la codificación, no el largo en chars.
    // "é" precompuesta (NFC) vs "e" + acento combinante (NFD).
    assert(!igualesEnTiempoConstante("é", "é"));
  },
);

Deno.test("esBase64Estandar acepta base64 estándar, con y sin relleno", () => {
  for (const v of ["AAAA", "QUJD", "AA==", "AAA="]) {
    assert(esBase64Estandar(v), v);
  }
});

Deno.test("esBase64Estandar rechaza lo que `atob` daría por bueno", () => {
  // Los tres casos que hacen de esta función algo necesario: `atob` descarta el
  // espacio en blanco antes de decodificar y acepta longitudes que no son
  // múltiplo de 4, así que valida valores que la librería de firmas rechaza.
  // El primero es, literalmente, el secreto que provocó el bug.
  for (const v of ["v1 no es base64", "AAAA\n", "AAA"]) {
    assert(!esBase64Estandar(v), v);
  }
});

Deno.test("esBase64Estandar rechaza relleno mal puesto y base64url", () => {
  // `-` y `_` son base64url: el que firma (GoTrue) decodifica con la variante
  // estándar, así que aceptarlos aquí solo escondería una discrepancia.
  for (const v of ["A===", "====", "AA=A", "AA-_", ""]) {
    assert(!esBase64Estandar(v), v);
  }
});
