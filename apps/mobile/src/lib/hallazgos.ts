import type {
  OrigenIncidencia,
  PeriodoPrecio,
  PromocionVigente,
  VeredictoPrecio,
} from "@market-track/shared";

// El ESPEJO EFÍMERO del motor de hallazgos, para que una visita hecha sin señal
// enseñe lo que el mercaderista tiene que atender. Ver docs/adr/0012.
//
// Nada de esto se persiste. La `incidencia` la crea el servidor y solo el
// servidor; esto es lo que se pinta MIENTRAS su fila no ha llegado, y en cuanto
// llega manda ella. Es la misma forma de duplicar que ADR-0011 declaró
// admisible para el quiebre: un eco para la UI, nunca el valor que se escribe.
//
// Vive aquí y NO en `packages/shared` a propósito: en `shared` el panel y el
// portal podrían importarlo, y volvería la discusión de qué pantalla tiene
// razón. Lo compartido es el corpus de casos (`@market-track/db`), que son datos
// y que ejecutan los dos lados — si el SQL cambia y esto no, CI se pone rojo.

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

/**
 * El periodo de precio que regía en una fecha.
 *
 * Espeja `app.precio_regular_vigente` bit a bit, incluido el desempate: el
 * precio GENERAL de la cadena (sin tipo de tienda) gana al específico, y entre
 * dos del mismo bucket gana el que empezó más tarde. Ese orden es contraintuitivo
 * y por eso se copia explícitamente en vez de deducirlo.
 */
export function precioRegularVigente(
  periodos: readonly PeriodoPrecio[],
  fecha: string,
): PeriodoPrecio | null {
  const vigentes = periodos.filter(
    (p) =>
      p.vigente_desde <= fecha &&
      (p.vigente_hasta === null || p.vigente_hasta >= fecha),
  );
  if (vigentes.length === 0) return null;

  return vigentes.reduce((mejor, actual) => {
    const generalMejor = mejor.tipo_tienda === null;
    const generalActual = actual.tipo_tienda === null;
    if (generalActual !== generalMejor) return generalActual ? actual : mejor;
    return actual.vigente_desde > mejor.vigente_desde ? actual : mejor;
  });
}

export type EntradaPrecio = {
  precioRegistrado: number | null;
  hayPromo: boolean | null;
  promoComunicada: boolean | null;
  toleranciaPct: number;
  periodos: readonly PeriodoPrecio[];
  promociones: readonly PromocionVigente[];
  fecha: string;
};

/**
 * El árbol de precio, espejado de `app.evaluar_precio_sku`.
 *
 * Devuelve el veredicto Y el precio contra el que se comparó, como el original:
 * el detalle que se pinta lleva los dos números, y recalcularlos aparte sería
 * una tercera copia de la misma cuenta.
 */
export function evaluarPrecio(entrada: EntradaPrecio): {
  veredicto: VeredictoPrecio;
  precioRegular: number | null;
} {
  const fuera = {
    veredicto: "sin_precio_vigente" as const,
    precioRegular: null,
  };
  if (entrada.precioRegistrado === null) return fuera;

  const periodo = precioRegularVigente(entrada.periodos, entrada.fecha);
  if (periodo === null) return fuera;

  const regular = periodo.precio;
  const tol = entrada.toleranciaPct;
  if (entrada.precioRegistrado > regular * (1 + tol / 100)) {
    return { veredicto: "sobreprecio", precioRegular: regular };
  }
  if (entrada.precioRegistrado >= regular * (1 - tol / 100)) {
    return { veredicto: "correcto", precioRegular: regular };
  }

  // Por debajo del regular: solo una promo vigente y comunicada lo justifica.
  // La más reciente que cubra la fecha, igual que el `order by fecha_inicio desc`.
  const promo = entrada.promociones
    .filter(
      (p) => p.fecha_inicio <= entrada.fecha && p.fecha_fin >= entrada.fecha,
    )
    .reduce<PromocionVigente | null>(
      (mejor, actual) =>
        mejor === null || actual.fecha_inicio > mejor.fecha_inicio
          ? actual
          : mejor,
      null,
    );

  if (promo?.comunicada === true) {
    return { veredicto: "correcto", precioRegular: regular };
  }
  if (entrada.hayPromo === true && entrada.promoComunicada !== true) {
    return { veredicto: "promo_no_comunicada", precioRegular: regular };
  }
  return { veredicto: "subvaluado_sin_promo", precioRegular: regular };
}

/** Un hallazgo derivado en local, con la clave natural que lo casa con el del servidor. */
export type HallazgoDerivado = {
  levantamientoId: string | null;
  skuId: string | null;
  exhibicionNegociadaId: string | null;
  origen: OrigenIncidencia;
  detalle: Record<string, number | string | null>;
};

/**
 * El centinela de los orígenes que el teléfono NO puede derivar.
 *
 * Existe para que el mapa de abajo sea exhaustivo: un origen nuevo en el enum no
 * compila hasta que alguien decida si la verja lo ve o no. Un `default` se lo
 * tragaría en silencio, y la verja subcontaría sin que nadie se enterase.
 */
export const NO_DERIVABLE_EN_LOCAL = Symbol("no derivable en local");

export type FilaSku = {
  levantamiento_id: string;
  sku_id: string;
  stock_sistema: number | null;
  stock_piso: number | null;
  precio_registrado: number | null;
  hay_promo: number | null;
  promo_comunicada: number | null;
};

export type FilaExhibicion = {
  levantamiento_id: string;
  exhibicion_negociada_id: string | null;
  instalada: number | null;
  unidades: number | null;
};

export type ContextoPrecio = {
  toleranciaPct: number;
  periodos: readonly PeriodoPrecio[];
  promociones: readonly PromocionVigente[];
  fecha: string;
};

/**
 * Los hallazgos de una fila de `levantamiento_sku`.
 *
 * `stock_piso` nulo NO es cero: es la fila recién creada por el paso "Antes +
 * SOS", que todavía no tiene stock. Tratarlo como cero inventaría un quiebre en
 * cada SKU nada más abrir el módulo — es el mismo borde que dejó mudo al motor
 * cuando su trigger miraba solo el INSERT.
 */
export function hallazgosDeSku(
  fila: FilaSku,
  contexto: ContextoPrecio,
): HallazgoDerivado[] {
  const encontrados: HallazgoDerivado[] = [];
  const base = {
    levantamientoId: fila.levantamiento_id,
    skuId: fila.sku_id,
    exhibicionNegociadaId: null,
  };

  if (fila.stock_sistema !== null && fila.stock_piso !== null) {
    if (esQuiebre(fila.stock_sistema, fila.stock_piso)) {
      encontrados.push({
        ...base,
        origen: "quiebre",
        detalle: {
          stock_sistema: fila.stock_sistema,
          stock_piso: fila.stock_piso,
        },
      });
    } else if (esDiferencia(fila.stock_sistema, fila.stock_piso)) {
      encontrados.push({
        ...base,
        origen: "diferencia_stock",
        detalle: {
          stock_sistema: fila.stock_sistema,
          stock_piso: fila.stock_piso,
          delta: deltaDiferencia(fila.stock_sistema, fila.stock_piso),
        },
      });
    }
  }

  const { veredicto, precioRegular } = evaluarPrecio({
    precioRegistrado: fila.precio_registrado,
    hayPromo: fila.hay_promo === null ? null : fila.hay_promo === 1,
    promoComunicada:
      fila.promo_comunicada === null ? null : fila.promo_comunicada === 1,
    toleranciaPct: contexto.toleranciaPct,
    periodos: contexto.periodos,
    promociones: contexto.promociones,
    fecha: contexto.fecha,
  });

  if (veredicto === "sobreprecio" || veredicto === "subvaluado_sin_promo") {
    encontrados.push({
      ...base,
      origen: "desviacion_precio",
      detalle: {
        precio_registrado: fila.precio_registrado,
        precio_regular: precioRegular,
        motivo: veredicto,
      },
    });
  } else if (veredicto === "promo_no_comunicada") {
    encontrados.push({
      ...base,
      origen: "promo_no_comunicada",
      detalle: {
        precio_registrado: fila.precio_registrado,
        precio_regular: precioRegular,
      },
    });
  }

  return encontrados;
}

/** El hallazgo de una exhibición negociada que no está instalada. */
export function hallazgosDeExhibicion(
  fila: FilaExhibicion,
): HallazgoDerivado[] {
  if (fila.exhibicion_negociada_id === null || fila.instalada !== 0) return [];
  return [
    {
      levantamientoId: fila.levantamiento_id,
      skuId: null,
      exhibicionNegociadaId: fila.exhibicion_negociada_id,
      origen: "exhibicion_no_instalada",
      detalle: { unidades: fila.unidades },
    },
  ];
}

/**
 * Qué orígenes sabe derivar el teléfono, y cuáles no.
 *
 * Mapa exhaustivo y no un `switch` con `default`: un origen nuevo en el enum
 * tiene que romper la compilación aquí para que alguien decida si la verja lo ve.
 */
export const DERIVABLE_EN_LOCAL: Record<
  OrigenIncidencia,
  true | typeof NO_DERIVABLE_EN_LOCAL
> = {
  quiebre: true,
  diferencia_stock: true,
  desviacion_precio: true,
  promo_no_comunicada: true,
  exhibicion_no_instalada: true,
  // Nada lo crea todavía, ni en el servidor ni aquí: la entidad `planograma` no
  // existe. Entra por el centinela y no por una rama para que el día que exista
  // haya que decidirlo a conciencia.
  incumplimiento_planograma: NO_DERIVABLE_EN_LOCAL,
};
