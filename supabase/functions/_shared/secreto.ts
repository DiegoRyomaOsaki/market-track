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
