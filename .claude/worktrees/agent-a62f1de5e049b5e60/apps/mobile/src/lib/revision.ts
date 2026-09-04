import { useQuery } from "@powersync/react-native";

// La revisión de sus reportes, tal como la ve el mercaderista (MAR-51).
//
// Solo lectura: la decisión la escribe el supervisor desde el panel y baja por la
// réplica. Cero red, como todo flujo de campo — un rechazo se lee igual en un
// sótano sin señal.
//
// La réplica solo trae las revisiones de SUS visitas (sync rules), así que las
// consultas de aquí no filtran por usuario.

export type DecisionLocal = "aprobada" | "rechazada";

const ETIQUETA_DECISION: Record<string, string> = {
  aprobada: "Aprobado",
  rechazada: "Rechazado",
};

/** El texto que ve el mercaderista. */
export function etiquetaDecision(decision: string | null): string {
  if (decision === null) return "Pendiente de revisión";
  return ETIQUETA_DECISION[decision] ?? decision;
}

export type RevisionLocal = {
  visita_id: string;
  decision: string;
  motivo: string | null;
  revisado_at: string;
  tienda_nombre: string | null;
};

/**
 * Cuántos días atrás se siguen mostrando los rechazos en la portada.
 *
 * Una revisión casi nunca llega el mismo día, así que el chip de la parada de hoy
 * no la enseñaría nunca: sin esta ventana, el mercaderista no se enteraría jamás
 * de que le rechazaron un reporte. Siete días es una semana de trabajo, que es lo
 * que él recuerda del contexto de la visita.
 */
export const DIAS_DE_RECHAZOS_VISIBLES = 7;

/** Los rechazos recientes: lo que hay que enseñarle sí o sí, y con su motivo. */
export function useRechazosRecientes(): RevisionLocal[] {
  const { data } = useQuery<RevisionLocal>(
    `SELECT rv.visita_id, rv.decision, rv.motivo, rv.revisado_at, t.nombre AS tienda_nombre
     FROM revision_visita rv
     JOIN visita v ON v.id = rv.visita_id
     LEFT JOIN tienda t ON t.id = v.tienda_id
     WHERE rv.decision = 'rechazada'
       AND rv.revisado_at >= datetime('now', ?)
     ORDER BY rv.revisado_at DESC`,
    [`-${DIAS_DE_RECHAZOS_VISIBLES} days`],
  );
  return data ?? [];
}

/**
 * Filtra los rechazos que siguen dentro de la ventana. Existe aparte de la
 * consulta para poder probar la regla sin el motor nativo: la consulta la resuelve
 * SQLite, esto la resuelve en TypeScript, y las dos dicen lo mismo.
 */
export function rechazosDentroDeVentana(
  revisiones: readonly RevisionLocal[],
  ahora: Date,
  dias = DIAS_DE_RECHAZOS_VISIBLES,
): RevisionLocal[] {
  const limite = ahora.getTime() - dias * 86_400_000;
  return revisiones.filter(
    (r) =>
      r.decision === "rechazada" && new Date(r.revisado_at).getTime() >= limite,
  );
}
