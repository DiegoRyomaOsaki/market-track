import type { RolUsuario } from "@market-track/shared";

// Los segmentos de ruta del sitio con control por rol.
export const SEGMENTOS = ["admin", "supervisor", "cliente"] as const;
export type Segmento = (typeof SEGMENTOS)[number];

// Qué segmentos ve cada rol. Record EXHAUSTIVO por rol: si una migración añade un
// rol, este objeto deja de compilar (no un `default` que lo trague en silencio).
// El cambio de contexto admin↔supervisor y el detalle de cada sección son de
// tickets del panel; aquí el mapeo es 1:1 más el mercaderista sin acceso web.
const SEGMENTOS_POR_ROL: Record<RolUsuario, ReadonlyArray<Segmento>> = {
  admin: ["admin"],
  supervisor: ["supervisor"],
  cliente: ["cliente"],
  // El mercaderista trabaja en la app móvil: no entra a ninguna sección web.
  mercaderista: [],
};

/** ¿Puede este rol entrar al segmento? `null` (sin sesión / rol ilegible) deniega todo. */
export function puedeAccederA(
  rol: RolUsuario | null,
  segmento: Segmento,
): boolean {
  if (rol === null) return false;
  return SEGMENTOS_POR_ROL[rol].includes(segmento);
}

function esSegmento(valor: string): valor is Segmento {
  return (SEGMENTOS as readonly string[]).includes(valor);
}

/** El primer tramo de la ruta, si es uno de los segmentos controlados; si no, null. */
export function segmentoDeRuta(pathname: string): Segmento | null {
  const primero = pathname.split("/")[1] ?? "";
  return esSegmento(primero) ? primero : null;
}
