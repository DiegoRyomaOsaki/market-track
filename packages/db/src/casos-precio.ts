// El corpus de casos del árbol de precio, definido UNA vez y ejecutado por los
// DOS lados: `app.evaluar_precio_sku` en Postgres (la autoridad) y el espejo
// efímero de `apps/mobile/src/lib/hallazgos.ts` (lo que el mercaderista ve sin
// señal). Ver docs/adr/0012.
//
// Son DATOS, no lógica. La regla no vive aquí ni puede: el espejo tiene que
// quedar inalcanzable para el panel y el portal, o volvería la discusión de qué
// pantalla tiene razón. Lo único compartible es en qué tienen que coincidir.
//
// Vive en `packages/db` y no en `packages/shared` para no crear un ciclo de
// workspace: `shared` ya depende de `db`, y `packages/db/test` necesita leerlo.
// `shared` lo reexporta para quien lo quiera desde ahí.

/** El veredicto del árbol, con los mismos nombres que el enum de Postgres. */
export type VeredictoPrecio =
  | "sin_precio_vigente"
  | "correcto"
  | "sobreprecio"
  | "promo_no_comunicada"
  | "subvaluado_sin_promo";

export type PeriodoPrecio = {
  precio: number;
  vigente_desde: string;
  vigente_hasta: string | null;
  /** Nulo = el precio general de la cadena, que GANA al específico por tipo. */
  tipo_tienda: string | null;
};

export type PromocionVigente = {
  precio_promo: number;
  fecha_inicio: string;
  fecha_fin: string;
  comunicada: boolean;
};

export type CasoPrecio = {
  nombre: string;
  /** El día de la visita, no el de hoy: el reporte reevalúa meses después. */
  fecha: string;
  precio_registrado: number | null;
  hay_promo: boolean | null;
  promo_comunicada: boolean | null;
  tolerancia_pct: number;
  periodos: PeriodoPrecio[];
  promociones: PromocionVigente[];
  espera: VeredictoPrecio;
  /** El precio contra el que se comparó, o null si no había ninguno vigente. */
  esperaRegular: number | null;
};

const REGULAR: PeriodoPrecio = {
  precio: 10,
  vigente_desde: "2026-01-01",
  vigente_hasta: null,
  tipo_tienda: null,
};

/**
 * Los casos. Cada uno fija UNA rama del árbol, y entre todos cubren los cinco
 * veredictos y los dos bordes de la tolerancia.
 */
export const CASOS_PRECIO: readonly CasoPrecio[] = [
  {
    nombre: "sin precio registrado no se puede evaluar",
    fecha: "2026-06-15",
    precio_registrado: null,
    hay_promo: null,
    promo_comunicada: null,
    tolerancia_pct: 5,
    periodos: [REGULAR],
    promociones: [],
    espera: "sin_precio_vigente",
    esperaRegular: null,
  },
  {
    nombre: "sin ningún periodo vigente tampoco",
    fecha: "2025-06-15",
    precio_registrado: 10,
    hay_promo: false,
    promo_comunicada: false,
    tolerancia_pct: 5,
    periodos: [REGULAR],
    promociones: [],
    espera: "sin_precio_vigente",
    esperaRegular: null,
  },
  {
    nombre: "un periodo CERRADO deja de valer pasada su fecha de fin",
    fecha: "2026-08-15",
    precio_registrado: 10,
    hay_promo: false,
    promo_comunicada: false,
    tolerancia_pct: 5,
    periodos: [{ ...REGULAR, vigente_hasta: "2026-07-31" }],
    promociones: [],
    espera: "sin_precio_vigente",
    esperaRegular: null,
  },
  {
    nombre: "el precio justo es correcto",
    fecha: "2026-06-15",
    precio_registrado: 10,
    hay_promo: false,
    promo_comunicada: false,
    tolerancia_pct: 5,
    periodos: [REGULAR],
    promociones: [],
    espera: "correcto",
    esperaRegular: 10,
  },
  {
    nombre: "el borde SUPERIOR de la tolerancia todavía es correcto",
    fecha: "2026-06-15",
    precio_registrado: 10.5,
    hay_promo: false,
    promo_comunicada: false,
    tolerancia_pct: 5,
    periodos: [REGULAR],
    promociones: [],
    espera: "correcto",
    esperaRegular: 10,
  },
  {
    nombre: "un céntimo por encima del borde ya es sobreprecio",
    fecha: "2026-06-15",
    precio_registrado: 10.51,
    hay_promo: false,
    promo_comunicada: false,
    tolerancia_pct: 5,
    periodos: [REGULAR],
    promociones: [],
    espera: "sobreprecio",
    esperaRegular: 10,
  },
  {
    nombre: "el borde INFERIOR de la tolerancia todavía es correcto",
    fecha: "2026-06-15",
    precio_registrado: 9.5,
    hay_promo: false,
    promo_comunicada: false,
    tolerancia_pct: 5,
    periodos: [REGULAR],
    promociones: [],
    espera: "correcto",
    esperaRegular: 10,
  },
  {
    nombre: "por debajo, con una promo vigente y COMUNICADA, es correcto",
    fecha: "2026-06-15",
    precio_registrado: 7,
    hay_promo: true,
    promo_comunicada: true,
    tolerancia_pct: 5,
    periodos: [REGULAR],
    promociones: [
      {
        precio_promo: 7,
        fecha_inicio: "2026-06-01",
        fecha_fin: "2026-06-30",
        comunicada: true,
      },
    ],
    espera: "correcto",
    esperaRegular: 10,
  },
  {
    nombre:
      "por debajo, sin promo en el maestro pero el mercaderista vio una sin comunicar",
    fecha: "2026-06-15",
    precio_registrado: 7,
    hay_promo: true,
    promo_comunicada: false,
    tolerancia_pct: 5,
    periodos: [REGULAR],
    promociones: [],
    espera: "promo_no_comunicada",
    esperaRegular: 10,
  },
  {
    nombre: "por debajo y sin ninguna promo que lo justifique",
    fecha: "2026-06-15",
    precio_registrado: 7,
    hay_promo: false,
    promo_comunicada: false,
    tolerancia_pct: 5,
    periodos: [REGULAR],
    promociones: [],
    espera: "subvaluado_sin_promo",
    esperaRegular: 10,
  },
  {
    nombre: "una promo del maestro FUERA de la fecha no justifica nada",
    fecha: "2026-08-15",
    precio_registrado: 7,
    hay_promo: false,
    promo_comunicada: false,
    tolerancia_pct: 5,
    periodos: [REGULAR],
    promociones: [
      {
        precio_promo: 7,
        fecha_inicio: "2026-06-01",
        fecha_fin: "2026-06-30",
        comunicada: true,
      },
    ],
    espera: "subvaluado_sin_promo",
    esperaRegular: 10,
  },
  {
    nombre:
      "el precio GENERAL de la cadena gana al específico por tipo de tienda",
    fecha: "2026-06-15",
    precio_registrado: 10,
    hay_promo: false,
    promo_comunicada: false,
    tolerancia_pct: 0,
    periodos: [
      REGULAR,
      {
        precio: 20,
        vigente_desde: "2026-01-01",
        vigente_hasta: null,
        tipo_tienda: "hiper",
      },
    ],
    espera: "correcto",
    esperaRegular: 10,
    promociones: [],
  },
  {
    nombre: "entre dos periodos generales gana el más reciente que ya empezó",
    fecha: "2026-06-15",
    precio_registrado: 12,
    hay_promo: false,
    promo_comunicada: false,
    tolerancia_pct: 0,
    periodos: [
      { ...REGULAR, vigente_hasta: "2026-05-31" },
      {
        precio: 12,
        vigente_desde: "2026-06-01",
        vigente_hasta: null,
        tipo_tienda: null,
      },
    ],
    promociones: [],
    espera: "correcto",
    esperaRegular: 12,
  },
  {
    nombre: "sin tolerancia, un céntimo de más ya es sobreprecio",
    fecha: "2026-06-15",
    precio_registrado: 10.01,
    hay_promo: false,
    promo_comunicada: false,
    tolerancia_pct: 0,
    periodos: [REGULAR],
    promociones: [],
    espera: "sobreprecio",
    esperaRegular: 10,
  },
];
