// Tests de la comparación en tiempo constante. Corren con
// `deno test supabase/functions` (sin base ni servidor).

import { assert } from "jsr:@std/assert@1";

import { igualesEnTiempoConstante } from "./secreto.ts";

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
