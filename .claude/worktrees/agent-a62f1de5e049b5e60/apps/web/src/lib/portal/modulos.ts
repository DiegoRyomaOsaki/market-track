import { type ModuloPortal, moduloPortalSchema } from "@market-track/shared";

// Presentación y estado de los módulos del portal cliente (MAR-81), sobre el
// modelo de MAR-74. La lógica pura vive aquí para poder probarla y para que la
// UI solo ensamble la pantalla.

/**
 * El nombre visible de cada módulo. Record EXHAUSTIVO: un módulo nuevo en el enum
 * obliga a nombrarlo aquí (no cae en un default silencioso).
 */
export const ETIQUETA_MODULO: Record<ModuloPortal, string> = {
  dashboard: "Dashboard de KPIs",
  mapa: "Mapa en vivo",
  galeria: "Galería de evidencia",
  alertas: "Alertas",
  reportes: "Reportes",
  perfect_store: "Perfect Store",
};

export type EstadoModulos = Record<ModuloPortal, boolean>;

/**
 * El estado de los módulos para un cliente: habilitado por defecto (coalesce
 * true), salvo una fila que lo deshabilite. Espeja `public.portal_modulos()` para
 * que el admin vea lo mismo que resolverá el portal. Ignora módulos que ya no
 * existen en el enum (overrides viejos).
 */
export function estadoDeModulos(
  overrides: readonly { modulo: string; habilitado: boolean }[],
): EstadoModulos {
  const porModulo = new Map(overrides.map((o) => [o.modulo, o.habilitado]));
  const estado = {} as EstadoModulos;
  for (const modulo of moduloPortalSchema.options) {
    estado[modulo] = porModulo.get(modulo) ?? true;
  }
  return estado;
}
