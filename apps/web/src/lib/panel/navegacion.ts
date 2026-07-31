// Modelo de navegación del panel: la fuente única de las secciones, sus rutas,
// los títulos del header y su AYUDA contextual. El sidebar lo pinta, el header lo
// consulta para titular la pantalla activa, y el popover `?` muestra `ayuda`. Los
// iconos son glifos (como en el mockup); una pasada de pulido puede cambiarlos por
// una librería sin tocar el resto.

export type AreaPanel = "admin" | "supervisor";

export type ItemNav = {
  href: string;
  label: string;
  icono: string;
  area: AreaPanel;
  titulo: string;
  subtitulo: string;
  ayuda: string;
};

export const NAV_ADMIN: readonly ItemNav[] = [
  {
    href: "/admin",
    label: "Clientes-marca",
    icono: "🏢",
    area: "admin",
    titulo: "Clientes-marca",
    subtitulo: "Marcas y su configuración por cliente",
    ayuda:
      "Las marcas de cada cliente y su configuración (tolerancia de precio, activación). Un cliente puede tener varias marcas —Oster, Sharpie…—; el SKU cuelga de la marca, no del cliente.",
  },
  {
    href: "/admin/catalogo",
    label: "Catálogo",
    icono: "📦",
    area: "admin",
    titulo: "Catálogo",
    subtitulo: "Cadenas, tiendas, SKUs y matriz de codificados",
    ayuda:
      "El maestro comercial: cadenas, tiendas (con su geocerca), SKUs y la matriz de qué SKU va codificado en cada tienda. Entra por la importación del Excel del cliente, no se teclea a mano.",
  },
  {
    href: "/admin/precios",
    label: "Precios y promos",
    icono: "🏷️",
    area: "admin",
    titulo: "Precios y promociones",
    subtitulo: "Precios regulares y promociones vigentes",
    ayuda:
      "Precios regulares y promociones vigentes por SKU. El motor de alertas compara lo que el mercaderista levanta en campo contra estos valores para detectar desviaciones de precio.",
  },
  {
    href: "/admin/exhibiciones",
    label: "Exhibiciones",
    icono: "🖼️",
    area: "admin",
    titulo: "Exhibiciones negociadas",
    subtitulo: "Espacios negociados por tienda",
    ayuda:
      "Los espacios de exhibición negociados por tienda. El mercaderista verifica en campo que se cumplan; si faltan, se dispara una alerta de exhibición incompleta.",
  },
  {
    href: "/admin/formularios",
    label: "Formularios",
    icono: "📝",
    area: "admin",
    titulo: "Constructor de formularios",
    subtitulo: "El formulario de levantamiento por cliente",
    ayuda:
      "Diseña el formulario que ven los mercaderistas: pasos, campos y su orden. Configura la presentación y los campos libres —los pasos con lógica (quiebres, precios, Share of Shelf) los calcula el sistema y no se editan aquí—. Publicar congela una versión inmutable y la envía al teléfono; los borradores no salen del panel.",
  },
  {
    href: "/admin/portal",
    label: "Portal cliente",
    icono: "🖥️",
    area: "admin",
    titulo: "Módulos del portal cliente",
    subtitulo: "Qué secciones ve cada cliente en su portal",
    ayuda:
      "Activa o desactiva las secciones del portal —dashboard, mapa, galería, alertas, reportes— por cada cliente. Una sección desactivada no se muestra ni es accesible por URL en el portal del cliente. Por defecto, un cliente nuevo tiene todas habilitadas.",
  },
  {
    href: "/admin/usuarios",
    label: "Usuarios",
    icono: "👥",
    area: "admin",
    titulo: "Usuarios",
    subtitulo: "Altas, roles y accesos",
    ayuda:
      "Alta y gestión de mercaderistas, supervisores, clientes y admins, con su rol y cliente-marca. Dar de baja a un cliente revoca el acceso de todos sus mercaderistas.",
  },
  {
    href: "/admin/importar",
    label: "Importar Excel",
    icono: "📄",
    area: "admin",
    titulo: "Importar Excel",
    subtitulo: "Carga del maestro comercial del cliente",
    ayuda:
      "Carga del Excel del cliente: se mapean sus columnas a las del sistema, se previsualiza fila por fila y se aplica de forma transaccional —todo o nada—. Un reimport actualiza, nunca borra por ausencia.",
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
    ayuda:
      "Las visitas del día en vivo: mapa con pines por estado, KPIs y el feed de alertas (quiebres, desviaciones de precio, contingencias) a medida que sincronizan los mercaderistas.",
  },
  {
    href: "/supervisor/ruteros",
    label: "Ruteros",
    icono: "🗓️",
    area: "supervisor",
    titulo: "Ruteros",
    subtitulo: "Diseño y publicación de ruteros semanales",
    ayuda:
      "La agenda semanal de cada mercaderista: se arrastran las tiendas a los días y se publica. El móvil recibe la asignación por push.",
  },
  {
    href: "/supervisor/revision",
    label: "Revisión",
    icono: "✅",
    area: "supervisor",
    titulo: "Revisión de reportes",
    subtitulo: "Cola de aprobación de levantamientos",
    ayuda:
      "La cola de levantamientos por aprobar: se revisa la evidencia —fotos antes/después, Share of Shelf— y se aprueba o se rechaza con un motivo.",
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
