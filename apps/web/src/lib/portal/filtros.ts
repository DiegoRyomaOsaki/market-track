// Los filtros globales del portal (MAR-54): rango de fechas · cadena · tienda.
// Viven en la URL (searchParams) para ser server-first (cada página los lee en el
// servidor) y COMPARTIBLES por enlace. Aquí, la lógica pura de leerlos/serializarlos
// —validando forma— para que la UI y las páginas no la repitan.

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
