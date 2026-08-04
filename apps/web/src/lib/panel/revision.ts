import type { Database } from "@market-track/db";

// La lógica PURA de la cola de revisión: cómo se lee cada fila en pantalla y cómo
// se aplica encima la decisión que se acaba de tomar.

type FilaCruda =
  Database["public"]["Functions"]["cola_revision"]["Returns"][number];

// El generador tipa toda columna de un `returns table` como no-nula. Aquí muchas
// no lo son: los campos de revisión solo existen una vez revisada, la geocerca la
// calcula el servidor y puede faltar, y el check-out puede no haber llegado.
type CamposOpcionales =
  | "check_out_at"
  | "duracion_min"
  | "check_in_geocerca_ok"
  | "check_out_geocerca_ok"
  | "decision"
  | "motivo"
  | "revisor_nombre"
  | "revisado_at";

export type DecisionRevision = Database["public"]["Enums"]["decision_revision"];

export type VisitaEnCola = Omit<FilaCruda, CamposOpcionales> & {
  check_out_at: string | null;
  duracion_min: number | null;
  check_in_geocerca_ok: boolean | null;
  check_out_geocerca_ok: boolean | null;
  // Nulo = pendiente de revisión. La ausencia de decisión ES el estado: no hay un
  // tercer valor del enum para algo que es que no exista la fila.
  decision: DecisionRevision | null;
  motivo: string | null;
  revisor_nombre: string | null;
  revisado_at: string | null;
};

// Record exhaustivo: si el enum crece, esto deja de compilar en vez de dejar un
// valor sin etiqueta que solo se descubre en pantalla.
const ETIQUETA_DECISION: Record<DecisionRevision, string> = {
  aprobada: "Aprobada",
  rechazada: "Rechazada",
};

const ESTILO_DECISION: Record<DecisionRevision, string> = {
  aprobada: "bg-completado-suave text-completado-texto",
  rechazada: "bg-alerta-suave text-alerta-texto",
};

const ETIQUETA_PENDIENTE = "Pendiente";
const ESTILO_PENDIENTE = "bg-en-curso-suave text-en-curso-texto";

export function etiquetaDecision(decision: DecisionRevision | null): string {
  return decision === null ? ETIQUETA_PENDIENTE : ETIQUETA_DECISION[decision];
}

export function estiloDecision(decision: DecisionRevision | null): string {
  return decision === null ? ESTILO_PENDIENTE : ESTILO_DECISION[decision];
}

/** Cuántas visitas esperan al supervisor. Alimenta el badge de la sección. */
export function pendientes(visitas: readonly VisitaEnCola[]): number {
  return visitas.filter((v) => v.decision === null).length;
}

/**
 * ¿Queda evidencia sin subir? Mientras las fotos sigan en el teléfono no hay nada
 * que firmar en R2, así que aprobar es aprobar a ciegas. Se avisa, no se bloquea:
 * un bloqueo duro dejaría reportes irrevisables si la cola a R2 se atasca.
 */
export function faltaEvidencia(visita: VisitaEnCola): boolean {
  return visita.fotos_pendientes > 0;
}

/**
 * Aplica la decisión sobre la lista que ya está en pantalla, sin esperar a que el
 * servidor recargue. Solo toca los campos que la decisión cambia.
 */
export function aplicarDecision(
  actuales: readonly VisitaEnCola[],
  decidida: {
    visitaId: string;
    decision: DecisionRevision;
    motivo: string | null;
    revisorNombre: string;
    revisadoAt: string;
  },
): VisitaEnCola[] {
  return actuales.map((v) =>
    v.visita_id === decidida.visitaId
      ? {
          ...v,
          decision: decidida.decision,
          motivo: decidida.motivo,
          revisor_nombre: decidida.revisorNombre,
          revisado_at: decidida.revisadoAt,
        }
      : v,
  );
}
