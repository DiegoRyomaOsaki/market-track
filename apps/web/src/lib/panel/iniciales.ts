// Iniciales para los avatares del shell. Puras y testeables (por eso viven fuera
// de los componentes que las pintan).

/** Dos iniciales de un nombre ("Ana María" → "AM"); "?" si no hay letras. */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/);
  const dos = ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase();
  return dos || "?";
}

/** Primera inicial ("Oster" → "O"); "?" si no hay letras. */
export function inicial(nombre: string): string {
  return (nombre.trim()[0] ?? "?").toUpperCase();
}
