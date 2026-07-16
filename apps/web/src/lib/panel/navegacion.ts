// Modelo de navegación del panel: la fuente única de las secciones, sus rutas y
// los títulos del header. El sidebar lo pinta y el header lo consulta para titular
// la pantalla activa. Los iconos son glifos (como en el mockup); una pasada de
// pulido puede cambiarlos por una librería sin tocar el resto.

export type AreaPanel = "admin" | "supervisor";

export type ItemNav = {
  href: string;
  label: string;
  icono: string;
  area: AreaPanel;
  titulo: string;
  subtitulo: string;
};

export const NAV_ADMIN: readonly ItemNav[] = [
  {
    href: "/admin",
    label: "Clientes-marca",
    icono: "🏢",
    area: "admin",
    titulo: "Clientes-marca",
    subtitulo: "Marcas y su configuración por cliente",
  },
  {
    href: "/admin/catalogo",
    label: "Catálogo",
    icono: "📦",
    area: "admin",
    titulo: "Catálogo",
    subtitulo: "Cadenas, tiendas, SKUs y matriz de codificados",
  },
  {
    href: "/admin/precios",
    label: "Precios y promos",
    icono: "🏷️",
    area: "admin",
    titulo: "Precios y promociones",
    subtitulo: "Precios regulares y promociones vigentes",
  },
  {
    href: "/admin/exhibiciones",
    label: "Exhibiciones",
    icono: "🖼️",
    area: "admin",
    titulo: "Exhibiciones negociadas",
    subtitulo: "Espacios negociados por tienda",
  },
  {
    href: "/admin/usuarios",
    label: "Usuarios",
    icono: "👥",
    area: "admin",
    titulo: "Usuarios",
    subtitulo: "Altas, roles y accesos",
  },
  {
    href: "/admin/importar",
    label: "Importar Excel",
    icono: "📄",
    area: "admin",
    titulo: "Importar Excel",
    subtitulo: "Carga del maestro comercial del cliente",
  },
];

export const NAV_SUPERVISOR: readonly ItemNav[] = [
  {
    href: "/supervisor",
    label: "Tablero",
    icono: "📊",
    area: "supervisor",
    titulo: "Tablero del día",
    subtitulo: "Visitas en vivo, KPIs y alertas",
  },
  {
    href: "/supervisor/ruteros",
    label: "Ruteros",
    icono: "🗓️",
    area: "supervisor",
    titulo: "Ruteros",
    subtitulo: "Diseño y publicación de ruteros semanales",
  },
  {
    href: "/supervisor/revision",
    label: "Revisión",
    icono: "✅",
    area: "supervisor",
    titulo: "Revisión de reportes",
    subtitulo: "Cola de aprobación de levantamientos",
  },
];

export const NAV: readonly ItemNav[] = [...NAV_ADMIN, ...NAV_SUPERVISOR];

/**
 * El item cuyo href hace el mejor match con el pathname (el prefijo más largo).
 * Sirve para resaltar el activo en el sidebar y titular el header.
 */
export function itemActivo(pathname: string): ItemNav | undefined {
  return NAV.filter(
    (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
  ).sort((a, b) => b.href.length - a.href.length)[0];
}
