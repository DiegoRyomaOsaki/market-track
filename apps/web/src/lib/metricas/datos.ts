import type {
  PeriodoPuntaje,
  PoliticaPop,
  TipoTienda,
  UnidadSos,
} from "@market-track/shared";

import { createServerSupabaseClient } from "@/lib/supabase/server";

// La lectura de servidor de la pantalla de métricas.
//
// Separada de los textos y de las acciones a propósito: aquí vive el cliente de
// Supabase, y arrastrarlo a un módulo que importa un componente cliente llevaría
// la validación de variables de entorno al navegador.
//
// Todo listado va ACOTADO: la configuración es histórica y crece con cada
// publicación, así que sin tope una marca con años de ajustes traería la pila
// entera para pintar las últimas.
const TOPE_VERSIONES = 50;

export type ConfigPerfectStore = {
  id: string;
  categoria_id: string | null;
  categoria_nombre: string | null;
  tipo_tienda: TipoTienda | null;
  peso_distribucion: number;
  peso_visibilidad: number;
  peso_precio: number;
  peso_pop: number;
  peso_orden: number;
  sos_objetivo_pct: number;
  sos_unidad: UnidadSos;
  politica_pop: PoliticaPop;
  orden_bien_pts: number;
  orden_regular_pts: number;
  orden_mal_pts: number;
  vigente_desde: string;
};

export type ConfigMerchandiser = {
  id: string;
  peso_puntualidad: number;
  peso_asistencia: number;
  peso_tiempo_efectivo: number;
  peso_calidad: number;
  peso_herramientas: number;
  tolerancia_puntualidad_min: number;
  minutos_tardanza_cero: number;
  dias_gracia_cierre: number;
  periodicidad: PeriodoPuntaje;
  umbral_fotos_sin_verificar_pct: number;
  vigente_desde: string;
};

export type NivelBono = {
  id: string;
  nombre: string;
  puntaje_min: number;
  monto: number;
  vigente_desde: string;
};

export type DatosMetricas = {
  marcas: { id: string; nombre: string }[];
  configsStore: ConfigPerfectStore[];
  configMerchandiser: ConfigMerchandiser | null;
  escalera: NivelBono[];
  /** Se distingue de «no hay nada»: un fallo de carga no es un estado vacío. */
  error: string | null;
};

/** Una fila de configuración de Perfect Store con la categoría ya resuelta. */
type FilaStore = Omit<ConfigPerfectStore, "categoria_nombre"> & {
  categoria: { nombre: string } | null;
};

/**
 * Lo que necesita la pantalla de métricas para un cliente y (opcionalmente) una
 * marca.
 *
 * La configuración de Perfect Store se lista por marca porque su resolución es
 * por especificidad —gana la fila más específica— y sin ver la pila el admin no
 * entiende por qué el puntaje usó unos pesos y no otros. La del plan de lealtad
 * es una sola por cliente: no tiene ejes.
 */
export async function datosDeMetricas(
  tenantId: string,
  marcaId: string | null,
): Promise<DatosMetricas> {
  const supabase = await createServerSupabaseClient();

  const [marcas, configsStore, configMerchandiser, escalera] =
    await Promise.all([
      supabase
        .from("marca")
        .select("id, nombre")
        .eq("tenant_id", tenantId)
        .eq("activo", true)
        .order("nombre"),
      marcaId
        ? supabase
            .from("config_perfect_store")
            .select(
              "id, categoria_id, tipo_tienda, peso_distribucion, peso_visibilidad, peso_precio, peso_pop, peso_orden, sos_objetivo_pct, sos_unidad, politica_pop, orden_bien_pts, orden_regular_pts, orden_mal_pts, vigente_desde, categoria:categoria_id(nombre)",
            )
            .eq("tenant_id", tenantId)
            .eq("marca_id", marcaId)
            .order("vigente_desde", { ascending: false })
            .limit(TOPE_VERSIONES)
        : null,
      supabase
        .from("config_perfect_merchandiser")
        .select(
          "id, peso_puntualidad, peso_asistencia, peso_tiempo_efectivo, peso_calidad, peso_herramientas, tolerancia_puntualidad_min, minutos_tardanza_cero, dias_gracia_cierre, periodicidad, umbral_fotos_sin_verificar_pct, vigente_desde",
        )
        .eq("tenant_id", tenantId)
        .order("vigente_desde", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("nivel_bono_merchandiser")
        .select("id, nombre, puntaje_min, monto, vigente_desde")
        .eq("tenant_id", tenantId)
        .order("vigente_desde", { ascending: false })
        .order("puntaje_min", { ascending: true })
        .limit(TOPE_VERSIONES),
    ]);

  const falloDeCarga =
    marcas.error ??
    configsStore?.error ??
    configMerchandiser.error ??
    escalera.error;
  if (falloDeCarga) {
    console.error("[metricas] carga", falloDeCarga.message.slice(0, 200));
    return {
      marcas: [],
      configsStore: [],
      configMerchandiser: null,
      escalera: [],
      error: "No se pudo cargar la configuración de métricas.",
    };
  }

  return {
    marcas: marcas.data ?? [],
    configsStore: ((configsStore?.data ?? []) as unknown as FilaStore[]).map(
      ({ categoria, ...fila }) => ({
        ...fila,
        categoria_nombre: categoria?.nombre ?? null,
      }),
    ),
    configMerchandiser: configMerchandiser.data,
    // Solo la escalera VIGENTE: la de mayor `vigente_desde`. Publicar una nueva
    // reemplaza la anterior entera, así que mezclar dos fechas en la pantalla
    // enseñaría peldaños que ya no aplican.
    escalera: escaleraVigente(escalera.data ?? []),
    error: null,
  };
}

/** Los peldaños de la fecha más reciente, ordenados de menor a mayor umbral. */
export function escaleraVigente(niveles: NivelBono[]): NivelBono[] {
  if (niveles.length === 0) return [];
  const masReciente = niveles.reduce(
    (max, n) => (n.vigente_desde > max ? n.vigente_desde : max),
    niveles[0]!.vigente_desde,
  );
  return niveles
    .filter((n) => n.vigente_desde === masReciente)
    .sort((a, b) => a.puntaje_min - b.puntaje_min);
}
