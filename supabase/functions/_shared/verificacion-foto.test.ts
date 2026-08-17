// Tests de la lógica pura de la verificación de fotos. Corren con
// `deno test supabase/functions` (sin base, sin servidor, sin R2).

import { assert, assertEquals } from "jsr:@std/assert@1";

import {
  decidirVerificacion,
  LIMITE_BARRIDO_DEFECTO,
  peticionVerificacionSchema,
  TOPE_BARRIDO,
} from "./verificacion-foto.ts";

const FOTO = "f0000010-0000-0000-0000-000000000001";

Deno.test(
  "decidirVerificacion: 200 con bytes sella; 200 sin tamaño también",
  () => {
    assertEquals(decidirVerificacion(200, 12_345), "sellar");
    assertEquals(decidirVerificacion(200, null), "sellar");
  },
);

Deno.test(
  "decidirVerificacion: 404 y objeto vacío son 'no_encontrada' (confirmado que no)",
  () => {
    assertEquals(decidirVerificacion(404, null), "no_encontrada");
    assertEquals(decidirVerificacion(200, 0), "no_encontrada");
  },
);

Deno.test(
  "decidirVerificacion: 403, 5xx y estado 0 (red) son 'reintentar', nunca 'no_encontrada'",
  () => {
    for (const estado of [403, 401, 429, 500, 502, 503, 504, 0]) {
      assertEquals(
        decidirVerificacion(estado, null),
        "reintentar",
        `estado ${estado}`,
      );
    }
  },
);

Deno.test("el schema acepta los dos modos", () => {
  assert(
    peticionVerificacionSchema.safeParse({ modo: "una", foto_id: FOTO })
      .success,
  );
  assert(peticionVerificacionSchema.safeParse({ modo: "barrer" }).success);
  assert(
    peticionVerificacionSchema.safeParse({
      modo: "barrer",
      limite: TOPE_BARRIDO,
    }).success,
  );
});

Deno.test(
  "el schema rechaza modo desconocido, límite fuera de rango y foto_id no uuid",
  () => {
    assert(!peticionVerificacionSchema.safeParse({ modo: "borrar" }).success);
    assert(
      !peticionVerificacionSchema.safeParse({ modo: "barrer", limite: 0 })
        .success,
    );
    assert(
      !peticionVerificacionSchema.safeParse({
        modo: "barrer",
        limite: TOPE_BARRIDO + 1,
      }).success,
    );
    assert(
      !peticionVerificacionSchema.safeParse({ modo: "barrer", limite: 1.5 })
        .success,
    );
    assert(
      !peticionVerificacionSchema.safeParse({ modo: "una", foto_id: "x" })
        .success,
    );
    assert(!peticionVerificacionSchema.safeParse({ modo: "una" }).success);
  },
);

Deno.test("el límite por defecto cabe dentro del tope", () => {
  assert(LIMITE_BARRIDO_DEFECTO >= 1 && LIMITE_BARRIDO_DEFECTO <= TOPE_BARRIDO);
});
