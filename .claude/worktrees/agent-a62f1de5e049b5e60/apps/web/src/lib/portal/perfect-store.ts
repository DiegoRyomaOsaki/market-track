import type { Database } from "@market-track/db";

import { calcularTendencia, type Kpi } from "@/lib/portal/dashboard";

import type { ParamsBusqueda } from "./filtros";

// La lógica PURA de la sección de Perfect Store del portal: qué nivel del
// drill-down toca, cómo se arma cada tarjeta de variable, adónde lleva cada fila
// del desglose y cómo se dibuja la serie. Los números los calcula la base
// (`perfect_store_agregado`, `_serie`, `_desglose`); aquí solo se presentan.

type TipoTienda = Database["public"]["Enums"]["tipo_tienda"];
type Granularidad = Database["public"]["Enums"]["granularidad_serie"];

export const NIVELES = [
  "categoria",
  "tipo_tienda",
  "cadena",
  "tienda",
] as const;
export type Nivel = (typeof NIVELES)[number];

const TIPOS_TIENDA: readonly TipoTienda[] = ["hiper", "super", "express"];
const GRANULARIDADES: readonly Granularidad[] = ["dia", "semana", "mes"];

export const ETIQUETA_NIVEL: Record<Nivel, string> = {
  categoria: "Categoría",
  tipo_tienda: "Tipo de tienda",
  cadena: "Cadena",
  tienda: "Tienda",
};

export const ETIQUETA_GRANULARIDAD: Record<Granularidad, string> = {
  dia: "Día",
  semana: "Semana",
  mes: "Mes",
};

/** El parámetro de URL con el que se estrecha cada nivel. */
const PARAM_DEL_NIVEL: Record<Nivel, string> = {
  categoria: "categoria",
  tipo_tienda: "tipotienda",
  cadena: "cadena",
  tienda: "tienda",
};

export type FiltrosPerfectStore = {
  categoria: string | null;
  tipoTienda: TipoTienda | null;
  granularidad: Granularidad;
};

const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function primero(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Los filtros propios de la sección: categoría · tipo de tienda · granularidad.
 *
 * `tipotienda` y no `tipo`: la galería y las alertas ya usan `tipo` con otro
 * significado en la misma URL, y los filtros globales se arrastran entre
 * secciones. Un valor con forma inválida se descarta — nunca llega a una query.
 */
export function leerFiltrosPerfectStore(
  params: ParamsBusqueda,
): FiltrosPerfectStore {
  const categoria = primero(params.categoria);
  const tipo = primero(params.tipotienda);
  const gran = primero(params.granularidad);
  return {
    categoria: categoria && RE_UUID.test(categoria) ? categoria : null,
    tipoTienda: TIPOS_TIENDA.includes(tipo as TipoTienda)
      ? (tipo as TipoTienda)
      : null,
    granularidad: GRANULARIDADES.includes(gran as Granularidad)
      ? (gran as Granularidad)
      : "semana",
  };
}

export type SeleccionDrilldown = {
  categoria: string | null;
  tipoTienda: TipoTienda | null;
  cadena: string | null;
  tienda: string | null;
};

/**
 * El nivel que toca desglosar, deducido de lo ya filtrado. `null` en la hoja: con
 * una tienda elegida no queda nada más hondo que mostrar.
 *
 * Es derivado a propósito. Guardar el nivel en la URL aparte de los filtros
 * permitiría llegar a estados imposibles —"desglosa por cadena" con una tienda
 * fijada— desde un enlace viejo.
 */
export function nivelDelDrilldown(sel: SeleccionDrilldown): Nivel | null {
  if (sel.tienda) return null;
  if (sel.cadena) return "tienda";
  if (sel.tipoTienda) return "cadena";
  if (sel.categoria) return "tipo_tienda";
  return "categoria";
}

/** El enlace que baja un nivel: los filtros actuales más la clave elegida. */
export function hrefDelGrupo(
  nivel: Nivel,
  clave: string,
  params: ParamsBusqueda,
): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const uno = primero(v);
    if (uno !== undefined) next.set(k, uno);
  }
  next.set(PARAM_DEL_NIVEL[nivel], clave);
  return `/cliente/perfect-store?${next.toString()}`;
}

export type Miga = { etiqueta: string; href: string };

/**
 * El rastro del drill-down. Cada miga vuelve a su nivel QUITANDO ese filtro y
 * todos los de abajo: subir a "Tipo de tienda" con la cadena todavía puesta
 * dejaría la pantalla en un nivel que ya no se está mirando.
 */
export function migasDelDrilldown(
  sel: SeleccionDrilldown,
  nombres: { categoria?: string; cadena?: string; tienda?: string },
  params: ParamsBusqueda,
): Miga[] {
  const base = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const uno = primero(v);
    if (uno !== undefined) base.set(k, uno);
  }

  const hrefSin = (desde: number): string => {
    const next = new URLSearchParams(base.toString());
    for (const nivel of NIVELES.slice(desde))
      next.delete(PARAM_DEL_NIVEL[nivel]);
    const qs = next.toString();
    return qs ? `/cliente/perfect-store?${qs}` : "/cliente/perfect-store";
  };

  // La etiqueta de cada nivel puesto, en el orden de `NIVELES`. Null si ese nivel
  // no está filtrado: no aparece en el rastro.
  const etiquetas: Array<string | null> = [
    sel.categoria ? (nombres.categoria ?? "Categoría") : null,
    sel.tipoTienda,
    sel.cadena ? (nombres.cadena ?? "Cadena") : null,
    sel.tienda ? (nombres.tienda ?? "Tienda") : null,
  ];

  const migas: Miga[] = [{ etiqueta: "Todo", href: hrefSin(0) }];
  etiquetas.forEach((etiqueta, i) => {
    if (etiqueta) migas.push({ etiqueta, href: hrefSin(i + 1) });
  });
  return migas;
}

// El generador tipa toda columna de una función `returns table` como no-nula,
// pero los promedios son nulos cuando no hay nada que promediar. Se corrige aquí;
// la fila cruda del rpc sigue siendo asignable a este tipo, más amplio.
type FilaAgregadoCruda =
  Database["public"]["Functions"]["perfect_store_agregado"]["Returns"][number];

export type FilaAgregado = Omit<
  FilaAgregadoCruda,
  "total_pct" | "distribucion_pct" | "visibilidad_pct" | "precio_pct"
> & {
  total_pct: number | null;
  distribucion_pct: number | null;
  visibilidad_pct: number | null;
  precio_pct: number | null;
};

type FilaDesgloseCruda =
  Database["public"]["Functions"]["perfect_store_desglose"]["Returns"][number];

export type FilaDesglose = Omit<
  FilaDesgloseCruda,
  "clave" | "total_pct" | "distribucion_pct" | "visibilidad_pct" | "precio_pct"
> & {
  // Nula cuando el grupo no es navegable: una cadena sin tipo de tienda.
  clave: string | null;
  total_pct: number | null;
  distribucion_pct: number | null;
  visibilidad_pct: number | null;
  precio_pct: number | null;
};

type PuntoSerieCrudo =
  Database["public"]["Functions"]["perfect_store_serie"]["Returns"][number];

export type PuntoSerie = Omit<PuntoSerieCrudo, "total_pct"> & {
  total_pct: number | null;
};

function pct(v: number | null): string {
  return v == null ? "—" : `${v}%`;
}

/**
 * Las seis tarjetas: el puntaje total y las cinco variables.
 *
 * POP y Orden salen SIEMPRE como no evaluadas porque hoy la base no las calcula
 * —el piloto mide tres de las cinco— y su peso se renormaliza entre las demás.
 * Se muestran igual: son parte de la métrica que se le vendió al cliente, y una
 * variable ausente de la pantalla no se distingue de una que salió en cero.
 */
export function armarVariables(
  actual: FilaAgregado | null,
  previo: FilaAgregado | null,
): Kpi[] {
  const noEvaluada = (clave: string, etiqueta: string): Kpi => ({
    clave,
    etiqueta,
    valor: "No evaluada",
    tendencia: { disponible: false },
    subirEsBueno: true,
    ayuda:
      "Todavía no se mide en campo. Su peso se reparte entre las variables que sí se evaluaron, así que no cuenta como cero ni baja el puntaje.",
  });

  const evaluada = (
    clave: string,
    etiqueta: string,
    ayuda: string,
    lee: (f: FilaAgregado) => number | null,
  ): Kpi => ({
    clave,
    etiqueta,
    valor: pct(actual ? lee(actual) : null),
    tendencia: calcularTendencia(
      actual ? lee(actual) : null,
      previo ? lee(previo) : null,
    ),
    subirEsBueno: true,
    ayuda,
  });

  return [
    evaluada(
      "total",
      "Puntaje Perfect Store",
      "El promedio ponderado de las variables evaluadas, con los pesos de la configuración vigente para tu marca. Una variable que no se evaluó no puntúa cero: su peso se reparte entre las demás.",
      (f) => f.total_pct,
    ),
    evaluada(
      "distribucion",
      "Distribución",
      "De los SKU codificados para la tienda, qué porcentaje se encontró en góndola (sin quiebre).",
      (f) => f.distribucion_pct,
    ),
    evaluada(
      "visibilidad",
      "Visibilidad",
      "Tu Share of Shelf medido —frentes propios sobre el total de frentes— comparado con el objetivo de tu configuración. Al llegar al objetivo la variable marca 100.",
      (f) => f.visibilidad_pct,
    ),
    evaluada(
      "precio",
      "Precio",
      "De los SKU con precio registrado y precio vigente que comparar, qué porcentaje estaba correcto.",
      (f) => f.precio_pct,
    ),
    noEvaluada("pop", "Material POP"),
    noEvaluada("orden", "Orden y limpieza"),
  ];
}

export type BarraSerie = {
  periodo: string;
  etiqueta: string;
  valor: number | null;
  levantamientos: number;
  /** La altura como fracción de 0 a 1. Cero cuando el bucket no tiene puntaje. */
  altura: number;
};

const FORMATO_DIA = new Intl.DateTimeFormat("es-PE", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
});
const FORMATO_MES = new Intl.DateTimeFormat("es-PE", {
  timeZone: "UTC",
  month: "short",
  year: "numeric",
});

/**
 * La serie lista para dibujar.
 *
 * La escala va SIEMPRE de 0 a 100, no al máximo observado: son porcentajes, y
 * reescalar al máximo haría que un 40 % pareciese lleno.
 *
 * Los buckets vacíos llegan de la base y se conservan: un hueco tiene que verse
 * como un hueco, no cerrarse uniendo los puntos que lo rodean.
 */
export function barrasDeSerie(
  serie: PuntoSerie[],
  granularidad: Granularidad,
): BarraSerie[] {
  const formato = granularidad === "mes" ? FORMATO_MES : FORMATO_DIA;
  return serie.map((p) => ({
    periodo: p.periodo,
    etiqueta: formato.format(new Date(`${p.periodo}T12:00:00Z`)),
    valor: p.total_pct,
    levantamientos: p.levantamientos,
    altura:
      p.total_pct == null ? 0 : Math.max(0, Math.min(100, p.total_pct)) / 100,
  }));
}
