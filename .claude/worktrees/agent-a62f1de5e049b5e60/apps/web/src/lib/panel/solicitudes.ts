import type { Database } from "@market-track/db";

// La lógica PURA de la bandeja de solicitudes de cambio de ruta: cómo se lee cada
// fila en pantalla y cómo se aplica encima lo que llega por Realtime.

type FilaCruda =
  Database["public"]["Functions"]["bandeja_solicitudes"]["Returns"][number];

// El generador tipa toda columna de un `returns table` como no-nula. Aquí varias
// lo son: la fecha y el rutero son opcionales en el modelo, y los campos de
// resolución solo existen una vez resuelta.
type CamposOpcionales =
  | "fecha"
  | "rutero_fecha"
  | "comentario_resolucion"
  | "resuelta_por_nombre"
  | "resuelta_at";

export type Solicitud = Omit<FilaCruda, CamposOpcionales> & {
  fecha: string | null;
  rutero_fecha: string | null;
  comentario_resolucion: string | null;
  resuelta_por_nombre: string | null;
  resuelta_at: string | null;
};

export type TipoSolicitud = Database["public"]["Enums"]["tipo_solicitud_ruta"];
export type EstadoSolicitud =
  Database["public"]["Enums"]["estado_solicitud_ruta"];

// Records exhaustivos: si el enum crece, esto deja de compilar en vez de dejar
// un valor sin etiqueta que solo se descubre en pantalla.
const ETIQUETA_TIPO: Record<TipoSolicitud, string> = {
  cambio_tienda: "Cambio de tienda",
  cambio_dia: "Cambio de día",
  no_visita: "No podrá visitar",
  otro: "Otro",
};

const ETIQUETA_ESTADO: Record<EstadoSolicitud, string> = {
  nueva: "Nueva",
  vista: "Vista",
  resuelta: "Aprobada",
  rechazada: "Rechazada",
};

export function etiquetaTipo(tipo: TipoSolicitud): string {
  return ETIQUETA_TIPO[tipo];
}

export function etiquetaEstado(estado: EstadoSolicitud): string {
  return ETIQUETA_ESTADO[estado];
}

/** Una solicitud sigue esperando decisión mientras no se apruebe ni se rechace. */
export function estaPendiente(estado: EstadoSolicitud): boolean {
  return estado === "nueva" || estado === "vista";
}

/** Cuántas esperan al supervisor. Alimenta el badge de la sección. */
export function pendientes(solicitudes: readonly Solicitud[]): number {
  return solicitudes.filter((s) => estaPendiente(s.estado)).length;
}

/**
 * Aplica la resolución sobre la lista que ya está en pantalla, sin esperar a que
 * el servidor recargue. Solo toca los campos que la resolución cambia.
 */
export function aplicarResolucion(
  actuales: readonly Solicitud[],
  resolucion: {
    id: string;
    estado: EstadoSolicitud;
    comentario: string;
    resueltaPorNombre: string;
    resueltaAt: string;
  },
): Solicitud[] {
  return actuales.map((s) =>
    s.id === resolucion.id
      ? {
          ...s,
          estado: resolucion.estado,
          comentario_resolucion: resolucion.comentario,
          resuelta_por_nombre: resolucion.resueltaPorNombre,
          resuelta_at: resolucion.resueltaAt,
        }
      : s,
  );
}
