// Lógica pura del pase de acceso temporal, COMPARTIDA por las Edge Functions que
// lo operan. Vive aquí —y no dentro de una función— por dos razones: fija en un
// solo sitio el FORMATO del `codigo_hash` que se guarda (`emitir-pase` lo
// escribe; `canjear-pase`, cuando aterrice, lo tiene que reproducir byte a byte),
// y así la lógica se testea sin levantar el servidor de la función.
//
// El código NUNCA se guarda en claro. Se guarda su HMAC-SHA256 con un secreto de
// servidor (PASE_HASH_SECRET): un volcado de la base, por sí solo, no permite
// recuperar el código de 6 dígitos sin además tener el secreto. Todo con Web
// Crypto, sin dependencias.

const DIGITOS = 6;
const RANGO = 10 ** DIGITOS;

/**
 * Código de 6 dígitos con randomness criptográfica y SIN sesgo de módulo: se
 * descartan los valores por encima del mayor múltiplo de 10^6 que cabe en 32
 * bits, para que cada código sea equiprobable.
 */
export function generarCodigo(): string {
  const maxSinSesgo = Math.floor(0xffffffff / RANGO) * RANGO;
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0]!;
  } while (n >= maxSinSesgo);
  return String(n % RANGO).padStart(DIGITOS, "0");
}

/** HMAC-SHA256(codigo) en hex, con el secreto de servidor como clave. */
export async function hashCodigo(
  codigo: string,
  secreto: string,
): Promise<string> {
  const clave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secreto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = await crypto.subtle.sign(
    "HMAC",
    clave,
    new TextEncoder().encode(codigo),
  );
  return [...new Uint8Array(firma)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
