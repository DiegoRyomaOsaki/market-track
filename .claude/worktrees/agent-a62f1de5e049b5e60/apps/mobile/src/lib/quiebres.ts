// Quiebre y diferencia son DERIVADOS por la base (trigger/vista): la app NO
// escribe esas columnas. Estas funciones son solo para el badge en vivo del
// paso — feedback inmediato mientras el mercaderista teclea, offline, antes de
// que el servidor calcule el flag definitivo. Espejan la regla del modelo
// (docs/03) para que el badge y el flag coincidan; son excluyentes por
// construcción (uno exige piso = 0, el otro piso > 0).

/** Quiebre: hay stock en sistema pero cero en piso. */
export function esQuiebre(stockSistema: number, stockPiso: number): boolean {
  return stockPiso === 0 && stockSistema > 0;
}

/** Diferencia: hay stock en piso pero no cuadra con el sistema. */
export function esDiferencia(stockSistema: number, stockPiso: number): boolean {
  return stockPiso > 0 && stockPiso !== stockSistema;
}

/** El delta piso − sistema, para mostrarlo junto al badge de diferencia. */
export function deltaDiferencia(
  stockSistema: number,
  stockPiso: number,
): number {
  return stockPiso - stockSistema;
}
