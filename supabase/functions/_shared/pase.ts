// Lógica pura del pase de acceso temporal, COMPARTIDA por las Edge Functions que
// lo operan. Vive aquí —y no dentro de una función— por dos razones: fija en un
// solo sitio el FORMATO del `codigo_hash` que se guarda (`emitir-pase` lo
// escribe; `canjear-pase` lo reproduce byte a byte para comparar), y así la
// lógica se testea sin levantar el servidor de la función.
//
// El código NUNCA se guarda en claro. Se guarda su HMAC-SHA256 con un secreto de
// servidor (PASE_HASH_SECRET): un volcado de la base, por sí solo, no permite
// recuperar el código de 6 dígitos sin además tener el secreto. Todo con Web
// Crypto, sin dependencias.

import { igualesEnTiempoConstante } from "./secreto.ts";

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

// --- Autorización de emisión --------------------------------------------------
// Se decide aquí, como función pura, por lo mismo que el hash: es el ÚNICO gate de
// acceso de `emitir-pase` (que corre con service_role y salta la RLS), y así se
// testea sin levantar el servidor. Replica el criterio de las políticas RLS de la
// tabla, endurecido: solo a un mercaderista, y sin filtrar existencia entre tenants.

export type PerfilAutz = {
  id: string;
  rol: string;
  supervisor_id: string | null;
};

export type DecisionEmision =
  { permitido: true } | { permitido: false; status: 403 | 404; error: string };

/**
 * ¿Puede `emisor` emitir un pase para `objetivo`? `objetivo` es null si el
 * `profile_id` pedido no existe. Reglas: admin a cualquier mercaderista;
 * supervisor solo a un mercaderista que le reporta. El staff no autorizado y el
 * objetivo inexistente devuelven la MISMA respuesta para el supervisor, para no
 * revelar si un `profile_id` de otro tenant existe (sonda de existencia).
 */
export function puedeEmitirPase(
  emisor: PerfilAutz,
  objetivo: PerfilAutz | null,
): DecisionEmision {
  const sinPermiso = {
    permitido: false,
    status: 403,
    error: "sin permiso para emitir un pase a este usuario",
  } as const;

  // Solo staff emite pases. Se rechaza ANTES de mirar al objetivo: un rol sin
  // permiso no puede así distinguir si el profile_id existe o no.
  if (emisor.rol !== "admin" && emisor.rol !== "supervisor") return sinPermiso;

  // El admin es staff global (no está acotado a un tenant): puede emitir a
  // cualquier mercaderista, y para él "no existe" (404) no filtra nada sensible.
  if (emisor.rol === "admin") {
    if (!objetivo) {
      return {
        permitido: false,
        status: 404,
        error: "usuario objetivo no encontrado",
      };
    }
    if (objetivo.rol !== "mercaderista") {
      return {
        permitido: false,
        status: 403,
        error: "el pase solo se emite a un mercaderista",
      };
    }
    return { permitido: true };
  }

  // Supervisor: solo a un mercaderista que le reporta. "No existe", "no es suyo" y
  // "no es mercaderista" comparten respuesta: no filtra existencia entre tenants.
  if (
    !objetivo ||
    objetivo.rol !== "mercaderista" ||
    objetivo.supervisor_id !== emisor.id
  ) {
    return sinPermiso;
  }
  return { permitido: true };
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

// --- El canje: comparar en tiempo constante -----------------------------------
//
// La comparación vive en `secreto.ts` (la comparten los webhooks); aquí solo se
// aplica a la lista de candidatos.

export type PaseCandidato = { id: string; codigo_hash: string };

/**
 * El pase cuyo hash coincide con el del código dictado, o null si ninguno. Se
 * comparan TODOS los candidatos (no se corta al encontrarlo): así el tiempo
 * tampoco revela en qué posición de la lista estaba el bueno.
 */
export function paseQueCoincide(
  hashDado: string,
  candidatos: readonly PaseCandidato[],
): PaseCandidato | null {
  let coincidencia: PaseCandidato | null = null;
  for (const pase of candidatos) {
    if (igualesEnTiempoConstante(hashDado, pase.codigo_hash)) {
      coincidencia = pase;
    }
  }
  return coincidencia;
}

// --- Cota antiabuso -----------------------------------------------------------

/**
 * El SQLSTATE con el que la base rechaza una emisión por encima del tope.
 *
 * El tope y su ventana viven en el trigger `pase_tope_por_ventana`, no aquí: si
 * los contara también esta función, serían dos definiciones del mismo número —y
 * la que se salta el rodeo por PostgREST es la de la base. Lo único que queda de
 * este lado es traducir el rechazo al 429 que el cliente espera.
 *
 * Se compara por CÓDIGO y no por el texto del mensaje: el mensaje es copy y
 * cambia; el SQLSTATE es el contrato.
 */
export const SQLSTATE_TOPE_ALCANZADO = "53400";
