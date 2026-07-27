// Los tokens visuales de la app del mercaderista, tomados del prototipo.
// Viven aquí y no repartidos por las pantallas: cuando el prototipo se refine
// (MAR-32), se cambian en un sitio.

export const colores = {
  fondo: "#0f1729",
  superficie: "#1a2337",
  borde: "#2a3450",
  texto: "#f8fafc",
  textoSuave: "#94a3b8",
  marca: "#4f46e5",
  marcaTexto: "#ffffff",
  alerta: "#dc2626",
  ambar: "#d97706",
  completado: "#16a34a",
} as const;

export const espacio = { xs: 4, s: 8, m: 16, l: 24, xl: 32 } as const;

export const radio = { s: 8, m: 12, l: 16 } as const;
