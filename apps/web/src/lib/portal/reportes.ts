import { z } from "zod";

import { armarKpis, type FilaKpis, type Kpi, type Periodo } from "./dashboard";
import {
  type FiltrosGlobales,
  type ParamsBusqueda,
  serializarFiltros,
} from "./filtros";

// El reporte del portal: los MISMOS KPI del dashboard, filtrados por el
// configurador y servidos en dos formatos.
//
// No calcula nada. Los KPI los deriva la base (`dashboard_kpis`) y los da forma
// `armarKpis` — un campo derivado tiene un solo dueño, así que aquí solo se
// SELECCIONA cuáles entran y se ordenan las filas. Si esto sumara, restara o
// promediara algo, el número del reporte podría dejar de cuadrar con el del
// dashboard y nadie se enteraría hasta que el cliente los comparase.
//
// La vista previa y el PDF son el mismo artefacto (el PDF lo imprime el
// navegador desde ese DOM), así que no pueden divergir. El Excel es el único
// segundo camino, y arranca de este mismo `armarReporte`: lo que cambia es el
// formateo final, nunca el cálculo.

export const CLAVES_KPI = [
  "cumplimiento",
  "quiebres",
  "diferencias",
  "sos",
  "exhibiciones",
  "precio",
] as const;

export type ClaveKpi = (typeof CLAVES_KPI)[number];

function esClaveKpi(v: string): v is ClaveKpi {
  return (CLAVES_KPI as readonly string[]).includes(v);
}

/**
 * Los KPI que pidió la URL.
 *
 * Devuelve `null` cuando el parámetro NO VINO (⇒ entran todos) y `[]` cuando
 * vino pero nada de lo que traía es válido (⇒ es un error que hay que decir).
 * Colapsar los dos casos en uno haría que un `?kpi=inventado` devolviera los
 * seis indicadores en silencio, que es justo la rama que el usuario necesita ver.
 */
export function leerKpis(params: ParamsBusqueda): ClaveKpi[] | null {
  const crudo = params.kpi;
  if (crudo === undefined) return null;

  const valores = Array.isArray(crudo) ? crudo : [crudo];
  const validos = valores.filter(esClaveKpi);
  // Se ordena por el catálogo, no por la URL: el orden del reporte es una
  // decisión del producto, no de quien escribe el enlace.
  return CLAVES_KPI.filter((c) => validos.includes(c));
}

export type FilaReporte = {
  clave: ClaveKpi;
  indicador: string;
  valor: string;
  /** El texto de la variación, con signo Y palabra: el color no es el dato. */
  variacion: string;
};

export type Reporte = {
  periodo: Periodo;
  filas: FilaReporte[];
};

/** «+3,1 (sube)» — nunca solo el número ni solo una flecha (WCAG 1.4.1). */
function textoDeVariacion(kpi: Kpi): string {
  if (!kpi.tendencia.disponible) return "Sin comparación";
  const { delta, direccion } = kpi.tendencia;
  if (direccion === "igual") return "Sin cambio";
  const signo = delta > 0 ? "+" : "";
  return `${signo}${delta} (${direccion})`;
}

/**
 * De la fila cruda de la base al reporte que se pinta y se exporta.
 *
 * `seleccion` a `null` significa "todos": es lo que devuelve `leerKpis` cuando
 * la URL no trae el parámetro.
 */
export function armarReporte(
  fila: FilaKpis | null,
  seleccion: ClaveKpi[] | null,
  periodo: Periodo,
): Reporte {
  if (fila === null) return { periodo, filas: [] };

  const elegidos = seleccion ?? [...CLAVES_KPI];
  const filas = armarKpis(fila)
    .filter((k) => (elegidos as string[]).includes(k.clave))
    .map((k) => ({
      clave: k.clave as ClaveKpi,
      indicador: k.etiqueta,
      valor: k.valor,
      variacion: textoDeVariacion(k),
    }));

  return { periodo, filas };
}

/** Las filas del Excel: cabecera más una por indicador. */
export function filasDelReporte(reporte: Reporte): (string | number)[][] {
  return [
    ["Indicador", "Valor", "Variación"],
    ...reporte.filas.map((f) => [f.indicador, f.valor, f.variacion]),
  ];
}

/**
 * El nombre del archivo. Solo letras y dos fechas ya validadas.
 *
 * NO lleva el nombre del cliente a propósito: es texto de la base, y meterlo en
 * una cabecera `Content-Disposition` con una comilla o un salto de línea dentro
 * es inyección de cabecera.
 */
export function nombreDeArchivo(periodo: Periodo): string {
  return `reporte-market-track-${periodo.desde}-${periodo.hasta}.xlsx`;
}

/** El querystring que comparten la vista previa y el enlace de descarga. */
export function serializarReporte(
  filtros: Partial<FiltrosGlobales>,
  kpis: ClaveKpi[] | null,
): string {
  const base = serializarFiltros(filtros);
  if (kpis === null) return base;

  const p = new URLSearchParams();
  for (const k of kpis) p.append("kpi", k);
  const cola = p.toString();
  if (!cola) return base;
  return base ? `${base}&${cola}` : `?${cola}`;
}

// ---------------------------------------------------------------------------
// El contrato del endpoint
//
// El route handler es un GET alcanzable por cualquiera con sesión: el enlace que
// lo apunta no es una verja. Y es MÁS ESTRICTO que la página a propósito —
// exportar "un periodo por defecto" que el usuario no vio en pantalla es
// exactamente la divergencia entre lo mostrado y lo descargado que este diseño
// evita.
// ---------------------------------------------------------------------------

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Días máximos de una ventana. Un rango de años no es un reporte: es un
 *  escaneo caro pedido a mano desde la URL. */
export const DIAS_MAXIMOS = 366;

const DIA_MS = 86_400_000;

function diasEntre(desde: string, hasta: string): number {
  const d1 = new Date(`${desde}T00:00:00Z`).getTime();
  const d2 = new Date(`${hasta}T00:00:00Z`).getTime();
  return Math.round((d2 - d1) / DIA_MS);
}

export const reporteQuerySchema = z
  .object({
    desde: z.string().regex(RE_FECHA, "fecha inválida"),
    hasta: z.string().regex(RE_FECHA, "fecha inválida"),
    // `z.guid()` y no `z.uuid()`: la estricta exige los bits de versión y
    // variante de la RFC 9562, que Postgres no impone — rechazaría ids que la
    // base considera válidos, incluidos los del seed.
    cadena: z.guid().nullable(),
    tienda: z.guid().nullable(),
    kpi: z.array(z.enum(CLAVES_KPI)).min(1).nullable(),
  })
  .refine((v) => v.desde <= v.hasta, {
    message: "el rango está invertido",
    path: ["hasta"],
  })
  .refine((v) => diasEntre(v.desde, v.hasta) <= DIAS_MAXIMOS, {
    message: "el rango es demasiado largo",
    path: ["hasta"],
  });

export type ReporteQuery = z.infer<typeof reporteQuerySchema>;
