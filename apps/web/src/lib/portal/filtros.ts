import {
  ESTADOS_ALERTA,
  type EstadoAlerta,
  SEVERIDADES_ALERTA,
  type SeveridadAlerta,
  TIPOS_ALERTA,
  type TipoAlerta,
  TIPOS_FOTO_PORTAL,
  type TipoFoto,
} from "@market-track/shared";

/** Los tipos que el portal ofrece filtrar (todos menos la selfie). */
export type TipoFotoPortal = Exclude<TipoFoto, "selfie">;

// Los filtros globales del portal (MAR-54): rango de fechas · cadena · tienda.
// Viven en la URL (searchParams) para ser server-first (cada página los lee en el
// servidor) y COMPARTIBLES por enlace. Aquí, la lógica pura de leerlos/serializarlos
// —validando forma— para que la UI y las páginas no la repitan.

/**
 * El tipo de foto de la galería. NO entra en `FiltrosGlobales` a propósito: ese
 * tipo es el contrato que comparten las cuatro secciones, y las RPC del dashboard
 * no saben recibirlo — un filtro de "tipo de foto" sobre unos KPI no significa
 * nada. Es un filtro de sección que vive en la misma URL.
 *
 * La selfie no se ofrece: es la cara de un empleado de la outsourcing. Quien la
 * excluye de verdad es el SQL; esto solo evita ofrecer un filtro que la base va a
 * ignorar de todas formas.
 */
export function leerTipoFoto(params: ParamsBusqueda): TipoFotoPortal | null {
  const v = primero(params.tipo);
  return v && (TIPOS_FOTO_PORTAL as readonly string[]).includes(v)
    ? (v as TipoFotoPortal)
    : null;
}

export type FiltrosGlobales = {
  desde: string | null; // fecha YYYY-MM-DD
  hasta: string | null;
  cadena: string | null; // uuid
  tienda: string | null; // uuid
};

export type ParamsBusqueda = Record<string, string | string[] | undefined>;

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function primero(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Lee y VALIDA los filtros desde los searchParams. Un valor con forma inválida
 * (fecha no ISO, id que no es uuid) se descarta como null: nunca llega a una query. */
export function leerFiltros(params: ParamsBusqueda): FiltrosGlobales {
  const conforme = (clave: string, re: RegExp): string | null => {
    const v = primero(params[clave]);
    return v && re.test(v) ? v : null;
  };
  return {
    desde: conforme("desde", RE_FECHA),
    hasta: conforme("hasta", RE_FECHA),
    cadena: conforme("cadena", RE_UUID),
    tienda: conforme("tienda", RE_UUID),
  };
}

/** Serializa los filtros a un querystring (`?desde=…&cadena=…`), omitiendo los
 * vacíos. Cadena vacía si no hay ninguno. Base para que el nav preserve el estado. */
export function serializarFiltros(filtros: Partial<FiltrosGlobales>): string {
  const p = new URLSearchParams();
  if (filtros.desde) p.set("desde", filtros.desde);
  if (filtros.hasta) p.set("hasta", filtros.hasta);
  if (filtros.cadena) p.set("cadena", filtros.cadena);
  if (filtros.tienda) p.set("tienda", filtros.tienda);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/**
 * Los filtros propios de la bandeja de alertas: tipo · severidad · estado · página.
 *
 * Como el tipo de foto de la galería, son de SECCIÓN y no globales: las RPC del
 * dashboard no saben recibirlos. Viven en la misma URL para que la bandeja se
 * comparta por enlace tal y como uno la dejó.
 */
export type FiltrosAlerta = {
  tipo: TipoAlerta | null;
  severidad: SeveridadAlerta | null;
  estado: EstadoAlerta | null;
  pagina: number;
};

/** El primer valor de una lista de valores permitidos, o null si no encaja. */
function unoDe<T extends string>(
  v: string | undefined,
  permitidos: readonly T[],
): T | null {
  return v && (permitidos as readonly string[]).includes(v) ? (v as T) : null;
}

export function leerFiltrosAlerta(params: ParamsBusqueda): FiltrosAlerta {
  return {
    tipo: unoDe(primero(params.tipo), TIPOS_ALERTA),
    severidad: unoDe(primero(params.severidad), SEVERIDADES_ALERTA),
    estado: unoDe(primero(params.estado), ESTADOS_ALERTA),
    pagina: leerPagina(primero(params.pagina)),
  };
}

/**
 * La página, siempre un entero ≥ 1.
 *
 * Nada de confiar en que la UI mande un número: la URL la escribe cualquiera.
 * El tope de tamaño lo pone el SQL —es la última palabra—; aquí solo se evita
 * pedir un offset absurdo.
 */
function leerPagina(v: string | undefined): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
