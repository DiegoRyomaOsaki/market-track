import type { ModuloPortal } from "@market-track/shared";

// La navegación del PORTAL del cliente (MAR-54). Cada sección está ligada a un
// módulo del enum `modulo_portal` (MAR-74): el shell la muestra solo si el módulo
// está habilitado para ese cliente, y la ruta se bloquea si no lo está.
//
// `mapa` NO es una sección: es un flag DENTRO del Dashboard (el mapa se oculta si
// está deshabilitado) — lo consume MAR-55. Por eso aquí hay 4 secciones, no 5.

export type ItemPortal = {
  href: string;
  label: string;
  icono: string;
  modulo: ModuloPortal;
  titulo: string;
  subtitulo: string;
  ayuda: string;
};

export const NAV_PORTAL: readonly ItemPortal[] = [
  {
    href: "/cliente",
    label: "Dashboard",
    icono: "📊",
    modulo: "dashboard",
    titulo: "Dashboard",
    subtitulo: "KPIs, mapa y alertas de tu marca",
    ayuda:
      "Los indicadores de tu marca en el periodo y las tiendas filtradas: cumplimiento, quiebres, Share of Shelf y desviaciones de precio, con el mapa de tiendas y el feed de alertas.",
  },
  {
    href: "/cliente/perfect-store",
    label: "Perfect Store",
    icono: "🎯",
    modulo: "perfect_store",
    titulo: "Perfect Store",
    subtitulo: "Puntaje de ejecución y su desglose",
    ayuda:
      "El puntaje de ejecución de tu marca: distribución, visibilidad y precio ponderados en un solo número, con su evolución en el tiempo y el desglose por categoría, tipo de tienda, cadena y tienda. Las variables que todavía no se miden en campo no puntúan cero: su peso se reparte entre las evaluadas.",
  },
  {
    href: "/cliente/galeria",
    label: "Galería",
    icono: "🖼️",
    modulo: "galeria",
    titulo: "Galería de evidencia",
    subtitulo: "Fotos antes/después por tienda",
    ayuda:
      "La evidencia fotográfica de cada visita: la góndola antes y después del trabajo del mercaderista, por tienda y fecha. Las fotos se sirven con enlaces firmados de corta duración.",
  },
  {
    href: "/cliente/alertas",
    label: "Alertas",
    icono: "🔔",
    modulo: "alertas",
    titulo: "Alertas",
    subtitulo: "Quiebres, precios y contingencias",
    ayuda:
      "Las alertas detectadas en campo: quiebres de stock, desviaciones de precio, exhibiciones incompletas y contingencias reportadas por el mercaderista, con su detalle y estado.",
  },
  {
    href: "/cliente/reportes",
    label: "Reportes",
    icono: "📄",
    modulo: "reportes",
    titulo: "Reportes",
    subtitulo: "Exportación a Excel y PDF",
    ayuda:
      "Arma y exporta reportes de tu operación (cumplimiento, quiebres, precios, exhibiciones) en Excel o PDF, según el periodo y las tiendas filtradas.",
  },
];

/**
 * El item cuyo href hace el mejor match con el pathname (el prefijo más largo).
 * Resalta el activo en el sidebar y titula el header. Igual que en el panel.
 */
export function itemPortalActivo(pathname: string): ItemPortal | undefined {
  return NAV_PORTAL.filter(
    (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
  ).sort((a, b) => b.href.length - a.href.length)[0];
}
