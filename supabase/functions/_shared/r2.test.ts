// Tests de la lógica pura del firmado de R2. Corren con `deno test supabase/functions`
// (sin base, sin servidor, sin credenciales reales de Cloudflare — el firmado de
// aws4fetch es cripto local). Cablearlos a CI es MAR-65. La prueba de invocación
// end-to-end (401 / 403 / omisión) también vive en ese arnés.

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

Deno.test("la expiración de lectura es de minutos y menor que la de subida", () => {
  assert(EXPIRACION_LECTURA_SEGUNDOS > 0);
  assert(EXPIRACION_LECTURA_SEGUNDOS <= 600);
  assert(EXPIRACION_SUBIDA_SEGUNDOS > EXPIRACION_LECTURA_SEGUNDOS);
});

Deno.test("el tope del lote de lectura es 50", () => {
  assertEquals(TOPE_LOTE_LECTURA, 50);
});

Deno.test("lecturaFirmadaSchema rechaza lote vacío y por encima del tope; acepta 1 y el tope", () => {
  assert(!lecturaFirmadaSchema.safeParse({ foto_ids: [] }).success);
  const deMas = Array.from({ length: TOPE_LOTE_LECTURA + 1 }, () => FOTO);
  assert(!lecturaFirmadaSchema.safeParse({ foto_ids: deMas }).success);
  assert(lecturaFirmadaSchema.safeParse({ foto_ids: [FOTO] }).success);
  const enElTope = Array.from({ length: TOPE_LOTE_LECTURA }, () => FOTO);
  assert(lecturaFirmadaSchema.safeParse({ foto_ids: enElTope }).success);
});

Deno.test("lecturaFirmadaSchema rechaza ids que no son uuid", () => {
  assert(!lecturaFirmadaSchema.safeParse({ foto_ids: ["no-es-uuid"] }).success);
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

    const get = await firmarGet(cliente, CFG_PRUEBA, key);
    assertMatch(get, /X-Amz-Signature=/);
    assert(get.includes(`X-Amz-Expires=${EXPIRACION_LECTURA_SEGUNDOS}`));
    assert(get.includes(CFG_PRUEBA.bucket));
    assert(get.includes(FOTO));

    const put = await firmarPut(cliente, CFG_PRUEBA, key);
    assert(put.includes(`X-Amz-Expires=${EXPIRACION_SUBIDA_SEGUNDOS}`));

    // El método va firmado: GET y PUT dan firmas distintas para la misma key.
    const firmaGet = new URL(get).searchParams.get("X-Amz-Signature");
    const firmaPut = new URL(put).searchParams.get("X-Amz-Signature");
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
