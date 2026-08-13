import type {
  PeriodoPuntaje,
  PoliticaPop,
  TipoTienda,
  UnidadSos,
} from "@market-track/shared";

// Los textos de la pantalla de métricas: cómo se calcula cada variable y cómo se
// lee cada valor de enum.
//
// Viven en `apps/web` y no en `packages/shared` a propósito: la ayuda del móvil
// está en shared porque VIAJA con la app a un sótano sin señal. Esto es panel
// web, y el resto de textos del panel ya viven junto a la navegación.
//
// Todos los mapas son `Record` exhaustivos sobre su unión: si el enum crece, esto
// deja de compilar en vez de dejar un hueco silencioso en la pantalla.

/** Las cinco variables de Perfect Store, en el orden en que se configuran. */
export const VARIABLES_PERFECT_STORE = [
  "distribucion",
  "visibilidad",
  "precio",
  "pop",
  "orden",
] as const;
export type VariablePerfectStore = (typeof VARIABLES_PERFECT_STORE)[number];

/** Las cinco del plan de lealtad del mercaderista. */
export const VARIABLES_MERCHANDISER = [
  "puntualidad",
  "asistencia",
  "tiempo_efectivo",
  "calidad",
  "herramientas",
] as const;
export type VariableMerchandiser = (typeof VARIABLES_MERCHANDISER)[number];

export const ETIQUETA_PERFECT_STORE: Record<VariablePerfectStore, string> = {
  distribucion: "Distribución",
  visibilidad: "Visibilidad (Share of Shelf)",
  precio: "Precio y promoción",
  pop: "Material POP",
  orden: "Orden y limpieza",
};

export const EXPLICACION_PERFECT_STORE: Record<VariablePerfectStore, string> = {
  distribucion:
    "De los SKU codificados para la tienda, cuántos estaban presentes. Un quiebre baja esta variable.",
  visibilidad:
    "El share of shelf medido contra el objetivo de la marca: frentes propios sobre el total del anaquel.",
  precio:
    "De los SKU con precio registrado, cuántos estaban dentro de la tolerancia de la marca.",
  pop: "El material POP instalado frente a lo comprometido. Todavía no se captura en el móvil: su peso se reparte entre las demás.",
  orden:
    "La escala cualitativa de orden y limpieza de la góndola. Todavía no se captura en el móvil: su peso se reparte entre las demás.",
};

export const ETIQUETA_MERCHANDISER: Record<VariableMerchandiser, string> = {
  puntualidad: "Puntualidad",
  asistencia: "Asistencia",
  tiempo_efectivo: "Tiempo efectivo de atención",
  calidad: "Calidad de registro",
  herramientas: "Herramientas de trabajo",
};

export const EXPLICACION_MERCHANDISER: Record<VariableMerchandiser, string> = {
  puntualidad:
    "El desvío contra la hora planificada de cada parada. Dentro de la tolerancia puntúa 100; a partir de ahí baja en línea recta hasta el tope de tardanza. Llegar antes no suma extra.",
  asistencia:
    "Cuántas paradas del rutero se visitaron. Una parada de un día que aún no cerró en Lima no cuenta como falta.",
  tiempo_efectivo:
    "Todavía no se puntúa: no hay una fórmula acordada y medir solo la velocidad premiaría hacerlo todo mal y rápido. Su peso está fijado en 0.",
  calidad:
    "De los campos obligatorios y las fotos que pedía el formulario de cada levantamiento, cuántos llegaron completos.",
  herramientas:
    "Del checklist del check-in, cuántas herramientas declaró llevar (y fotografió). No tomar la foto pesa igual que no llevarlas.",
};

export const ETIQUETA_PERIODO: Record<PeriodoPuntaje, string> = {
  mensual: "Mensual",
  trimestral: "Trimestral",
  anual: "Anual",
};

export const ETIQUETA_UNIDAD_SOS: Record<UnidadSos, string> = {
  frentes: "Frentes",
  centimetros: "Centímetros",
};

export const ETIQUETA_POLITICA_POP: Record<PoliticaPop, string> = {
  dentro_del_tope: "Dentro del tope (máximo 100)",
  bonus_sobre_100: "Bonus sobre 100",
};

export const ETIQUETA_TIPO_TIENDA: Record<TipoTienda, string> = {
  hiper: "Hipermercado",
  super: "Supermercado",
  express: "Express",
};

/** El aviso que acompaña SIEMPRE a la vista previa, no solo tras calcularla. */
export const LIMITE_VISTA_PREVIA =
  "La previa re-pondera un puntaje ya calculado. No recalcula las variables: cambiar el objetivo de share of shelf o la política de POP no se refleja aquí.";

/** Lo que hay que decir cuando no hay ningún puntaje que re-ponderar. */
export const VACIO_VISTA_PREVIA_STORE =
  "Esta marca todavía no tiene ningún puntaje de Perfect Store calculado, así que no hay nada que re-ponderar.";
export const VACIO_VISTA_PREVIA_MERCHANDISER =
  "Todavía no se ha calculado ningún periodo del plan de lealtad, así que no hay puntaje que re-ponderar.";

/** El recordatorio de que publicar no toca el histórico. */
export const NOTA_PUBLICAR =
  "Publicar crea una versión nueva. Los puntajes ya calculados no cambian: cada uno guarda con qué configuración se calculó.";
