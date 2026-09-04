// El cálculo del Share of Shelf: fuera de la UI (regla de negocio). "Frentes",
// nunca "caras" ni "facing". El agregado de góndola compara frentes propios vs
// la suma de la competencia; el detalle por SKU debe cuadrar con ese agregado.

export type FrenteCompetidor = { competidor: string; frentes: number };

/** Suma de frentes de todos los competidores. Ignora conteos negativos. */
export function sumaCompetencia(items: readonly FrenteCompetidor[]): number {
  return items.reduce((total, c) => total + Math.max(0, c.frentes), 0);
}

/**
 * % de share propio en vivo: propios / (propios + competencia), redondeado.
 * Sin frentes contados aún, es 0 (no divide por cero).
 */
export function shareEnVivo(propios: number, competencia: number): number {
  const total = Math.max(0, propios) + Math.max(0, competencia);
  if (total === 0) return 0;
  return Math.round((Math.max(0, propios) / total) * 100);
}

/**
 * ¿El detalle por SKU cuadra con el agregado? La suma de frentes propios de cada
 * SKU debería igualar el conteo agregado de la góndola. Si no cuadra, la UI da un
 * aviso suave (no bloquea: el mercaderista puede tener una razón).
 */
export function detalleCuadra(
  agregadoPropios: number,
  sumaDetallePropios: number,
): boolean {
  return agregadoPropios === sumaDetallePropios;
}
