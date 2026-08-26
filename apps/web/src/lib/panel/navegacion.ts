import type { RolUsuario } from "@market-track/shared";

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
    subtitulo: "Cadenas, tiendas, SKUs, categorías y matriz de codificados",
    ayuda:
      "El maestro comercial: cadenas, tiendas (con su geocerca), SKUs, sus categorías y la matriz de qué SKU va codificado en cada tienda. Entra por la importación del Excel del cliente, no se teclea a mano. La categoría es el eje por el que Perfect Store pondera el puntaje —no se mide por SKU sino por categoría y tipo de tienda—; es opcional, y un SKU sin categoría no entra en el puntaje.",
  },
  {
    href: "/admin/precios",
    label: "Precios y promos",
    icono: "🏷️",
    area: "admin",
    titulo: "Precios y promociones",
    subtitulo: "Precios regulares y promociones vigentes",
    ayuda:
      "Precios regulares y promociones vigentes por SKU. El motor de alertas compara lo que el mercaderista levanta en campo contra estos valores para detectar desviaciones de precio. La fecha de vigencia forma parte de la identidad del precio: para subirlo a partir de un día se da de alta uno nuevo con esa fecha, no se edita el anterior —así queda el histórico—. Una promoción sin clusters aplica a todas las tiendas.",
  },
  {
    href: "/admin/exhibiciones",
    label: "Exhibiciones",
    icono: "🖼️",
    area: "admin",
    titulo: "Exhibiciones negociadas",
    subtitulo: "Espacios negociados por tienda",
    ayuda:
      "Los espacios de exhibición negociados por tienda. Los negocia una MARCA, no el cliente entero: la misma tienda puede tener a la vez una cabecera de una marca y una isla de otra. El mercaderista verifica en campo que se cumplan; si faltan, se dispara una alerta de exhibición incompleta. Renegociar el mismo espacio para otro periodo es un alta nueva con su fecha de inicio, no una edición.",
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
    href: "/admin/acceso",
    label: "Acceso y 2FA",
    icono: "🔐",
    area: "admin",
    titulo: "Acceso y segundo factor",
    subtitulo: "Canales del código y pases de acceso temporal",
    ayuda:
      "Por qué canales puede llegar el código de segundo factor (una sola política para toda la plataforma, no por cliente) y el pase de acceso temporal para el mercaderista que no lo recibe y está en tienda. La bitácora deja constancia de quién emitió cada pase y por qué; un pase vigente se puede revocar.",
  },
  {
    href: "/admin/importar",
    label: "Importar Excel",
    icono: "📄",
    area: "admin",
    titulo: "Importar Excel",
    subtitulo: "Carga del maestro comercial del cliente",
    ayuda:
      "Carga del maestro comercial sobre el cliente-marca activo. Se descarga la plantilla —una hoja por entidad, con sus cabeceras—, el cliente la rellena, y al subirla se previsualiza fila por fila: los errores se listan con su número de fila del Excel y hasta que no queda ninguno no se puede aplicar. Aplicar es todo o nada. Un reimport actualiza lo que ya existe y crea lo nuevo; nada se borra ni se desactiva por no venir en el archivo.",
  },
  {
    href: "/admin/metricas",
    label: "Métricas y bonos",
    icono: "🎯",
    area: "admin",
    titulo: "Métricas y bonos",
    subtitulo: "Pesos de Perfect Store y del plan de lealtad",
    ayuda:
      "Los pesos con los que se calculan las dos métricas: Perfect Store (por marca, afinable por categoría y tipo de tienda) y el plan de lealtad del mercaderista, con su escalera de bonos. Publicar crea una versión nueva: los puntajes ya calculados guardan con qué configuración se hicieron y no se mueven.",
  },
  {
    href: "/admin/ranking",
    label: "Ranking",
    icono: "🏆",
    area: "admin",
    titulo: "Ranking de mercaderistas",
    subtitulo: "Puntaje del plan de lealtad por periodo",
    ayuda:
      "El ranking completo del plan de lealtad del cliente activo: posición, puntaje total y desglose por variable (puntualidad, asistencia, calidad de registro, herramientas), con la evolución contra el periodo anterior y el nivel de bono alcanzado. «Sin datos» significa que el periodo no se evaluó, no que puntúe cero. El detalle de cada mercaderista explica de dónde sale cada punto, parada a parada.",
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
    href: "/supervisor/solicitudes",
    label: "Solicitudes",
    icono: "🙋",
    area: "supervisor",
    titulo: "Solicitudes de cambio de ruta",
    subtitulo: "Peticiones del equipo pendientes de decisión",
    ayuda:
      "Lo que el mercaderista pide desde la app cuando no puede seguir su rutero: cambiar de tienda o de día, o no visitar. Llegan con su motivo y se aprueban o rechazan con un comentario, que él lee en el móvil. Aprobar no reordena el rutero solo: desde aquí se pasa a Ruteros para ajustarlo.",
  },
  {
    href: "/supervisor/acceso",
    label: "Acceso y 2FA",
    icono: "🔐",
    area: "supervisor",
    titulo: "Acceso y segundo factor",
    subtitulo: "Pases de acceso temporal de tu equipo",
    ayuda:
      "El pase de acceso temporal para el mercaderista de tu equipo que no recibe su código y está en tienda: se emite con un motivo, se dicta una sola vez y vence a los 15 minutos. Queda registrado a tu nombre, y se puede revocar mientras siga vigente.",
  },
  {
    href: "/supervisor/revision",
    label: "Revisión",
    icono: "✅",
    area: "supervisor",
    titulo: "Revisión de reportes",
    subtitulo: "Cola de aprobación de visitas cerradas",
    ayuda:
      "La cola de visitas cerradas por aprobar. Se abre el reporte —fotos antes/después, Share of Shelf, stock, precios, contingencias y bitácora— y se aprueba o se rechaza. Rechazar exige un motivo, y el mercaderista lo lee en su app: es lo que le dice qué corregir. Una visita sin cerrar no entra aquí; esa se persigue desde el Tablero.",
  },
  {
    href: "/supervisor/metricas",
    label: "Métricas y bonos",
    icono: "🎯",
    area: "supervisor",
    titulo: "Métricas y bonos",
    subtitulo: "Pesos de Perfect Store y del plan de lealtad",
    ayuda:
      "Los pesos con los que se calculan las dos métricas: Perfect Store (por marca, afinable por categoría y tipo de tienda) y el plan de lealtad del mercaderista, con su escalera de bonos. Publicar crea una versión nueva: los puntajes ya calculados guardan con qué configuración se hicieron y no se mueven. Solo el admin publica; aquí se consultan.",
  },
  {
    href: "/supervisor/ranking",
    label: "Ranking",
    icono: "🏆",
    area: "supervisor",
    titulo: "Ranking de mercaderistas",
    subtitulo: "El puntaje de tu equipo, con las posiciones del cliente",
    ayuda:
      "El ranking del plan de lealtad de tu equipo: posición, puntaje total y desglose por variable, con la evolución contra el periodo anterior y el nivel de bono alcanzado. Ves solo a los tuyos, pero sus posiciones son las del cliente entero. «Sin datos» significa que el periodo no se evaluó, no que puntúe cero. El detalle explica cada punto, parada a parada.",
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

/**
 * Cómo se nombra cada rol en pantalla.
 *
 * `Record` exhaustivo y no un `capitalize` de CSS: el bloque de usuario es el
 * mismo en el panel y en el portal, y ahí la segunda línea a veces es el rol y a
 * veces el nombre de un cliente-marca. `text-transform: capitalize` sube la
 * primera letra de cada palabra sin bajar el resto, así que una marca escrita a
 * propósito en minúscula saldría deformada. Y siendo `Record`, si
 * `rol_usuario` gana un valor esto deja de compilar en vez de pintarlo crudo.
 */
export const ETIQUETA_ROL: Record<RolUsuario, string> = {
  admin: "Administrador",
  supervisor: "Supervisor",
  cliente: "Cliente",
  mercaderista: "Mercaderista",
};
