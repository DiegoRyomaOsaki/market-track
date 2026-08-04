// El vocabulario del mapa de pines, compartido por el dashboard del portal y el
// tablero del supervisor. Vive aquí y no en el módulo de uno de los dos para que
// el componente de mapa no dependa de ninguna pantalla concreta.

export type ColorPin = "verde" | "ambar" | "rojo";

/** El hex de cada estado. Lo usa MapLibre, que no entiende clases de Tailwind. */
export const COLOR_PIN_HEX: Record<ColorPin, string> = {
  verde: "#16a34a",
  ambar: "#d97706",
  rojo: "#dc2626",
};

/**
 * Un pin ya listo para pintar. El `href` y la `descripcion` vienen resueltos por
 * quien lo arma: el mapa no sabe de galerías ni de visitas, y así se pueden pasar
 * desde un Server Component (son datos, no funciones).
 */
export type PinMapa = {
  id: string;
  nombre: string;
  lat: number;
  lon: number;
  color: ColorPin;
  /** A dónde lleva el pin al pulsarlo. */
  href: string;
  /** Qué se lee en voz alta del estado del pin, p. ej. "visita en curso". */
  descripcion: string;
};
