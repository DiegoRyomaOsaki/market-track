// Tests de la lógica pura del firmado de R2. Corren con `deno test supabase/functions`
// (sin base, sin servidor, sin credenciales reales de Cloudflare — el firmado de
// aws4fetch es cripto local). La prueba de invocación end-to-end (401 / 403 /
// omisión) necesita un stack de Supabase levantado, así que espera al arnés de CI
// de Edge Functions.

import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";

import {
  clienteR2,
  type ConfigR2,
  construirKeyFoto,
  endpointR2,
  EXPIRACION_LECTURA_SEGUNDOS,
  EXPIRACION_SUBIDA_SEGUNDOS,
  firmarGet,
  firmarPut,
  lecturaFirmadaSchema,
  leerConfigR2,
  puedeSubirFoto,
  subidaFirmadaSchema,
  TOPE_LOTE_LECTURA,
} from "./r2.ts";

const CFG_PRUEBA: ConfigR2 = {
  accountId: "cuenta-de-prueba",
  accessKeyId: "clave-de-prueba",
  secretAccessKey: "secreto-de-prueba",
  bucket: "fotos-prueba",
};

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const VISITA = "d0000010-0000-0000-0000-000000000001";
const FOTO = "f0000010-0000-0000-0000-000000000001";

Deno.test("construirKeyFoto es tenant/visita/foto-id, en ese orden", () => {
  assertEquals(
    construirKeyFoto({ tenantId: TENANT, visitaId: VISITA, fotoId: FOTO }),
    `${TENANT}/${VISITA}/${FOTO}`,
  );
});

Deno.test("construirKeyFoto tiene exactamente tres segmentos", () => {
  const key = construirKeyFoto({
    tenantId: TENANT,
    visitaId: VISITA,
    fotoId: FOTO,
  });
  assertEquals(key.split("/").length, 3);
});

Deno.test("endpointR2 arma el host de la cuenta sin barra final", () => {
  assertEquals(
    endpointR2("mi-cuenta"),
    "https://mi-cuenta.r2.cloudflarestorage.com",
  );
});

Deno.test(
  "la expiración de lectura es de minutos y menor que la de subida",
  () => {
    assert(EXPIRACION_LECTURA_SEGUNDOS > 0);
    assert(EXPIRACION_LECTURA_SEGUNDOS <= 600);
    assert(EXPIRACION_SUBIDA_SEGUNDOS > EXPIRACION_LECTURA_SEGUNDOS);
  },
);

Deno.test("el tope del lote de lectura es 50", () => {
  assertEquals(TOPE_LOTE_LECTURA, 50);
});

Deno.test(
  "lecturaFirmadaSchema rechaza lote vacío y por encima del tope; acepta 1 y el tope",
  () => {
    assert(!lecturaFirmadaSchema.safeParse({ foto_ids: [] }).success);
    const deMas = Array.from({ length: TOPE_LOTE_LECTURA + 1 }, () => FOTO);
    assert(!lecturaFirmadaSchema.safeParse({ foto_ids: deMas }).success);
    assert(lecturaFirmadaSchema.safeParse({ foto_ids: [FOTO] }).success);
    const enElTope = Array.from({ length: TOPE_LOTE_LECTURA }, () => FOTO);
    assert(lecturaFirmadaSchema.safeParse({ foto_ids: enElTope }).success);
  },
);

Deno.test("lecturaFirmadaSchema rechaza ids que no son uuid", () => {
  assert(!lecturaFirmadaSchema.safeParse({ foto_ids: ["no-es-uuid"] }).success);
});

Deno.test(
  "lecturaFirmadaSchema rechaza el campo ausente (distinto de vacío)",
  () => {
    assert(!lecturaFirmadaSchema.safeParse({}).success);
    assert(!lecturaFirmadaSchema.safeParse({ foto_ids: undefined }).success);
  },
);

Deno.test(
  "subidaFirmadaSchema acepta un par de uuids y rechaza lo demás",
  () => {
    assert(
      subidaFirmadaSchema.safeParse({ visita_id: VISITA, foto_id: FOTO })
        .success,
    );
    // Falta un campo.
    assert(!subidaFirmadaSchema.safeParse({ visita_id: VISITA }).success);
    assert(!subidaFirmadaSchema.safeParse({ foto_id: FOTO }).success);
    // Cadena vacía (distinta de ausente) y no-uuid.
    assert(
      !subidaFirmadaSchema.safeParse({ visita_id: "", foto_id: FOTO }).success,
    );
    assert(
      !subidaFirmadaSchema.safeParse({ visita_id: VISITA, foto_id: "x" })
        .success,
    );
  },
);

Deno.test("puedeSubirFoto: solo el mercaderista dueño de la visita", () => {
  assert(puedeSubirFoto({ mercaderista_id: "u1" }, "u1"));
  // Del mismo tenant pero no el dueño.
  assert(!puedeSubirFoto({ mercaderista_id: "u1" }, "u2"));
  // Visita oculta por RLS (otro tenant o inexistente) → misma respuesta que no-dueño.
  assert(!puedeSubirFoto(null, "u1"));
});

Deno.test(
  "firmarGet/firmarPut producen una URL prefirmada con firma, expiración, bucket y key",
  async () => {
    const cliente = clienteR2(CFG_PRUEBA);
    const key = construirKeyFoto({
      tenantId: TENANT,
      visitaId: VISITA,
      fotoId: FOTO,
    });

    const get = new URL(await firmarGet(cliente, CFG_PRUEBA, key));
    assertMatch(get.searchParams.get("X-Amz-Signature") ?? "", /.+/);
    assertEquals(
      get.searchParams.get("X-Amz-Expires"),
      String(EXPIRACION_LECTURA_SEGUNDOS),
    );
    // La ruta es exactamente /bucket/tenant/visita/foto — un reordenamiento de
    // segmentos o una fuga no pasaría un substring suelto, pero sí este igual.
    assertEquals(get.pathname, `/${CFG_PRUEBA.bucket}/${key}`);
    // Servido forzado a imagen en línea (cierra el XSS almacenado).
    assertEquals(get.searchParams.get("response-content-type"), "image/jpeg");
    assertMatch(
      get.searchParams.get("response-content-disposition") ?? "",
      /^inline/,
    );

    const put = new URL(await firmarPut(cliente, CFG_PRUEBA, key));
    assertEquals(
      put.searchParams.get("X-Amz-Expires"),
      String(EXPIRACION_SUBIDA_SEGUNDOS),
    );
    assertEquals(put.pathname, `/${CFG_PRUEBA.bucket}/${key}`);

    // El método va firmado: GET y PUT dan firmas distintas para la misma key.
    const firmaGet = get.searchParams.get("X-Amz-Signature");
    const firmaPut = put.searchParams.get("X-Amz-Signature");
    assert(firmaGet !== null && firmaGet !== firmaPut);
  },
);

Deno.test("leerConfigR2 es fail-closed: si falta una variable, lanza", () => {
  const completo: Record<string, string | undefined> = {
    R2_ACCOUNT_ID: "a",
    R2_ACCESS_KEY_ID: "b",
    R2_SECRET_ACCESS_KEY: "c",
    R2_BUCKET: "d",
  };
  assertEquals(leerConfigR2(completo), {
    accountId: "a",
    accessKeyId: "b",
    secretAccessKey: "c",
    bucket: "d",
  });
  for (const faltante of Object.keys(completo)) {
    const parcial = { ...completo, [faltante]: undefined };
    let lanzo = false;
    try {
      leerConfigR2(parcial);
    } catch {
      lanzo = true;
    }
    assert(lanzo, `sin ${faltante} debería lanzar`);
  }
});
