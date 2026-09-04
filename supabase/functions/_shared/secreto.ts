// Comparación de secretos en tiempo constante. Único dueño: la usan el canje del
// pase (`pase.ts`) y las funciones que un webhook o el cron invocan con un secreto
// compartido en la cabecera (`enviar-alerta-email`, `fotos-verificar`).
//
// Un `===` entre strings corta en el primer byte distinto, y ese tiempo se mide.
// Aquí se recorren SIEMPRE todos los bytes y se acumula la diferencia con XOR: el
// tiempo depende del largo, nunca de en qué posición divergen.

/** ¿Son iguales, sin que el tiempo de la respuesta revele en qué byte difieren? */
export function igualesEnTiempoConstante(a: string, b: string): boolean {
  const bytesA = new TextEncoder().encode(a);
  const bytesB = new TextEncoder().encode(b);
  // Largos distintos = distintos, pero se recorre igual el más largo para no
  // devolver antes; el resultado ya está decidido por la diferencia de largo.
  let diferencia = bytesA.length ^ bytesB.length;
  const largo = Math.max(bytesA.length, bytesB.length);
  for (let i = 0; i < largo; i++) {
    diferencia |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0);
  }
  return diferencia === 0;
}

/**
 * ¿Tiene forma de base64 estándar? Pre-filtro, no validador canónico.
 *
 * Existe porque `atob` NO sirve de árbitro: sigue la especificación web y
 * DESCARTA los espacios en blanco antes de decodificar, así que da por bueno lo
 * que un decodificador estricto rechaza. Medido con el secreto que dejó
 * `test:sync` inservible durante un mes: llevaba un espacio en medio, `atob` lo
 * decodificaba sin quejarse y la librería moría igual.
 *
 * No pretende ser el árbitro final —acepta relleno no canónico, con bits
 * sobrantes distintos de cero, que un decodificador maximalista rechazaría—:
 * pretende que un valor obviamente roto muera con un mensaje que diga qué
 * variable mirar, en vez de dentro de las tripas de una librería.
 */
export function esBase64Estandar(valor: string): boolean {
  return (
    valor.length > 0 &&
    valor.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(valor)
  );
}
