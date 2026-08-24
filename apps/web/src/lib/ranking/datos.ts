import type { PeriodoPuntaje } from "@market-track/shared";

import { inicioDePeriodo } from "@/lib/ranking/ranking";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// La lectura de servidor del ranking. Separada de los componentes por lo mismo
// que `lib/metricas/datos.ts`: aquí vive el cliente de Supabase, y probarla no
// exige montar React.
//
// Quien autoriza es el servidor: la RPC del ranking corta con 42501 a quien no
// es staff y le devuelve al supervisor SOLO su equipo; la del detalle, igual.
// Nada de eso se re-decide aquí.

/** Cota defensiva: el piloto son decenas de mercaderistas, no miles. */
const TOPE_FILAS = 200;
/** Un periodo anual de un veterano ronda las 250 paradas. */
const TOPE_PARADAS = 500;

export type FilaRanking = {
  mercaderista_id: string;
  nombre: string;
  activo: boolean;
  posicion: number | null;
  hay_empate: boolean;
  total_pct: number | null;
  puntualidad_pct: number | null;
  asistencia_pct: number | null;
  calidad_pct: number | null;
  herramientas_pct: number | null;
  nivel_bono: string | null;
  nivel_bono_monto: number | null;
  cerrado: boolean;
  cierre_bloqueado: boolean;
  total_anterior: number | null;
  posicion_anterior: number | null;
  config_distinta: boolean;
  calculado_at: string | null;
};

export type DatosRanking = {
  filas: FilaRanking[];
  /** El tipo de periodo efectivamente consultado y su día de inicio. */
  tipo: PeriodoPuntaje;
  inicio: string;
  /** `false` = el cliente no tiene plan de lealtad configurado. */
  hayConfig: boolean;
  /** Se distingue de «no hay nada»: un fallo de carga no es un estado vacío. */
  error: string | null;
};

/**
 * El ranking de un cliente. El tipo por defecto es la PERIODICIDAD configurada
 * del plan —no un `mensual` escrito aquí—, y el periodo pedido se alinea
 * siempre al inicio que le corresponde: un `?periodo=2026-07-15` mensual
 * consulta julio, no una ventana inventada de mitad de mes.
 */
export async function datosDeRanking(
  tenantId: string,
  tipoElegido: PeriodoPuntaje | null,
  periodoElegido: string | null,
  hoyLima: string,
): Promise<DatosRanking> {
  const supabase = await createServerSupabaseClient();

  const config = await supabase
    .from("config_perfect_merchandiser")
    .select("periodicidad")
    .eq("tenant_id", tenantId)
    .order("vigente_desde", { ascending: false })
    .limit(1)
    .maybeSingle();

  const tipo = tipoElegido ?? config.data?.periodicidad ?? "mensual";
  const inicio = inicioDePeriodo(tipo, periodoElegido ?? hoyLima);

  if (config.error) {
    console.error("[ranking] config", config.error.message.slice(0, 200));
    return {
      filas: [],
      tipo,
      inicio,
      hayConfig: false,
      error: "No se pudo cargar el ranking.",
    };
  }

  const ranking = await supabase
    .rpc("ranking_merchandiser", {
      p_tenant: tenantId,
      p_tipo: tipo,
      p_inicio: inicio,
    })
    .limit(TOPE_FILAS);

  if (ranking.error) {
    console.error("[ranking] carga", ranking.error.message.slice(0, 200));
    return {
      filas: [],
      tipo,
      inicio,
      hayConfig: config.data !== null,
      error: "No se pudo cargar el ranking.",
    };
  }

  return {
    filas: ranking.data ?? [],
    tipo,
    inicio,
    hayConfig: config.data !== null,
    error: null,
  };
}

export type ParadaDetalle = {
  parada_id: string;
  fecha: string;
  tienda_nombre: string | null;
  hora_planificada: string | null;
  check_in_at: string | null;
  minutos_desvio: number | null;
  asistencia: "pendiente" | "asistio" | "falto";
  puntos: number | null;
};

export type PuntajeDetalle = {
  puntualidad_pct: number | null;
  asistencia_pct: number | null;
  calidad_pct: number | null;
  herramientas_pct: number | null;
  total_pct: number | null;
  paradas_evaluables: number;
  paradas_asistidas: number;
  paradas_con_hora: number;
  paradas_puntuales: number;
  campos_obligatorios: number;
  campos_respondidos: number;
  fotos_esperadas: number;
  fotos_presentes: number;
  items_checklist: number;
  items_cumplidos: number;
  fotos_del_periodo: number;
  fotos_subidas: number;
  fotos_verificadas: number;
  cierre_bloqueado: boolean;
  cerrado_at: string | null;
  calculado_at: string;
  nivel: { nombre: string; monto: number } | null;
  config: {
    tolerancia_puntualidad_min: number;
    minutos_tardanza_cero: number;
    umbral_fotos_sin_verificar_pct: number;
  } | null;
};

export type DatosDetalle = {
  nombre: string | null;
  /** `null` = el periodo no se calculó para este mercaderista. */
  puntaje: PuntajeDetalle | null;
  paradas: ParadaDetalle[];
  error: string | null;
};

export async function datosDeDetalle(
  mercaderistaId: string,
  tipo: PeriodoPuntaje,
  inicio: string,
): Promise<DatosDetalle> {
  const supabase = await createServerSupabaseClient();

  const [perfil, puntaje, paradas] = await Promise.all([
    supabase
      .from("profile")
      .select("nombre")
      .eq("id", mercaderistaId)
      .maybeSingle(),
    supabase
      .from("puntaje_merchandiser")
      .select(
        "puntualidad_pct, asistencia_pct, calidad_pct, herramientas_pct, total_pct, paradas_evaluables, paradas_asistidas, paradas_con_hora, paradas_puntuales, campos_obligatorios, campos_respondidos, fotos_esperadas, fotos_presentes, items_checklist, items_cumplidos, fotos_del_periodo, fotos_subidas, fotos_verificadas, cierre_bloqueado, cerrado_at, calculado_at, nivel:nivel_bono_id(nombre, monto), config:config_id(tolerancia_puntualidad_min, minutos_tardanza_cero, umbral_fotos_sin_verificar_pct)",
      )
      .eq("mercaderista_id", mercaderistaId)
      .eq("tipo", tipo)
      .eq("periodo_inicio", inicio)
      .maybeSingle(),
    supabase
      .rpc("paradas_del_periodo_merchandiser", {
        p_mercaderista: mercaderistaId,
        p_tipo: tipo,
        p_inicio: inicio,
      })
      .limit(TOPE_PARADAS),
  ]);

  const fallo = perfil.error ?? puntaje.error ?? paradas.error;
  if (fallo) {
    console.error("[ranking] detalle", fallo.message.slice(0, 200));
    return {
      nombre: null,
      puntaje: null,
      paradas: [],
      error: "No se pudo cargar el detalle.",
    };
  }

  return {
    nombre: perfil.data?.nombre ?? null,
    puntaje: puntaje.data,
    paradas: (paradas.data ?? []).map((p) => ({
      parada_id: p.parada_id,
      fecha: p.fecha,
      tienda_nombre: p.tienda_nombre,
      hora_planificada: p.hora_planificada,
      check_in_at: p.check_in_at,
      minutos_desvio: p.minutos_desvio,
      asistencia: p.asistencia,
      puntos: p.puntos,
    })),
    error: null,
  };
}
