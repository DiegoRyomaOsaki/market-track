import { useQuery } from "@powersync/react-native";

// Solicitud de cambio de ruta (MAR-77): reglas puras + lectura de la réplica
// local. La escritura (que toca `db`) vive en solicitud-ruta-crear.ts, aparte,
// para que este módulo se pueda probar sin el motor nativo. La réplica solo trae
// las SUYAS (sync rules), así que leerlas no necesita filtro.

export const TIPOS_SOLICITUD = [
  { id: "cambio_tienda", label: "Cambiar una tienda de la ruta" },
  { id: "cambio_dia", label: "Cambiar el día de una visita" },
  { id: "no_visita", label: "No podré visitar una tienda" },
  { id: "otro", label: "Otro" },
] as const;

export type TipoSolicitud = (typeof TIPOS_SOLICITUD)[number]["id"];

/** Una solicitud es válida si el tipo es conocido y el motivo no está vacío. */
export function solicitudValida(tipo: string, motivo: string): boolean {
  return TIPOS_SOLICITUD.some((t) => t.id === tipo) && motivo.trim().length > 0;
}

const ESTADO_ETIQUETA: Record<string, string> = {
  nueva: "Enviada",
  vista: "Vista por el supervisor",
  resuelta: "Resuelta",
  rechazada: "Rechazada",
};

/** El texto que ve el mercaderista para el estado de su solicitud. */
export function etiquetaEstado(estado: string): string {
  return ESTADO_ETIQUETA[estado] ?? estado;
}

/** El tenant del usuario, leído de su perfil en la réplica local. */
export function useMiTenant(userId: string): string | null {
  const { data } = useQuery<{ tenant_id: string }>(
    `SELECT tenant_id FROM profile WHERE id = ?`,
    [userId],
  );
  return data?.[0]?.tenant_id ?? null;
}

export type SolicitudLocal = {
  id: string;
  tipo: string;
  motivo: string;
  estado: string;
  comentario_resolucion: string | null;
  creada_at: string;
};

/** Las solicitudes del mercaderista (la réplica solo tiene las suyas). */
export function useMisSolicitudes() {
  const { data } = useQuery<SolicitudLocal>(
    `SELECT id, tipo, motivo, estado, comentario_resolucion, creada_at
     FROM solicitud_cambio_ruta ORDER BY creada_at DESC`,
  );
  return data ?? [];
}
