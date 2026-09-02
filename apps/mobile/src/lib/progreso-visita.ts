import { PASO_CONFIGURABLE, type PasoWizard } from "./pasos-levantamiento";

// El progreso de cada módulo dentro de una marca.
//
// Con navegación libre el mercaderista entra a los módulos en el orden que
// quiera, así que "¿cuál sigue?" deja de existir y la pregunta pasa a ser "¿cuál
// me falta?". Este archivo es el ÚNICO que la responde: el menú de visita, el
// selector de marca y el cierre del levantamiento leen todos de aquí.
//
// Las dos señales son filas persistidas, no estado en RAM:
//
//   `levantamiento_paso`  — el mercaderista dio el módulo por terminado
//   `contingencia`        — no lo pudo terminar, y dijo por qué (el bypass)
//
// Que las dos vivan en la base es lo que hace que saltar de módulo, cambiar de
// marca o que Android mate la app en un sótano no borren el avance.

/** Una fila de `levantamiento_paso`: el módulo que el mercaderista cerró. */
export type ModuloHecho = {
  paso: string;
  paso_config_id: string | null;
};

/** Una fila de `contingencia`: el módulo que no pudo cerrar, y por qué. */
export type ModuloOmitido = ModuloHecho & {
  motivo: string;
};

export type EstadoModulo = "pendiente" | "completado" | "omitido";

export type ProgresoModulo = {
  estado: EstadoModulo;
  /**
   * El motivo del bypass, si el módulo se omitió alguna vez. Sobrevive a que se
   * complete después: la contingencia ya disparó su alerta al supervisor y sigue
   * siendo la prueba de que el paso se atascó.
   */
  motivoOmision?: string;
};

/**
 * Empareja una fila de `levantamiento_paso` o `contingencia` con su módulo.
 *
 * Los pasos configurables comparten todos el enum `campos_extra`, así que el
 * enum no los distingue: el que manda es `paso_config_id`. Y al revés, un paso
 * fijo lleva `paso_config_id` nulo. Mirar solo una de las dos columnas
 * confundiría un configurable con otro.
 */
function esDelModulo(fila: ModuloHecho, modulo: PasoWizard): boolean {
  if (modulo.tipo === "configurable") {
    return fila.paso === PASO_CONFIGURABLE && fila.paso_config_id === modulo.id;
  }
  return fila.paso === modulo.paso && fila.paso_config_id === null;
}

/**
 * El estado de cada módulo de UNA marca, llaveado por el id del módulo.
 *
 * `completado` gana a `omitido` cuando existen los dos. Es la razón de ser del
 * ticket: "el mercaderista no puede quedarse trabado — si no lo dejan entrar a
 * la trastienda, sigue avanzando y vuelve después". Si al volver lo termina, el
 * módulo está hecho; pintarlo "Omitido" negaría el trabajo que acaba de hacer.
 * La contingencia no se borra y su motivo viaja en `motivoOmision`.
 *
 * Solo se devuelven los módulos que la definición de ESTA marca tiene: una fila
 * de un paso que el formulario ya no incluye (se republicó) no puede colarse en
 * el menú ni contar para el cierre.
 */
export function estadoDeModulos(
  modulos: readonly PasoWizard[],
  hechos: readonly ModuloHecho[],
  omitidos: readonly ModuloOmitido[],
): Map<string, ProgresoModulo> {
  const estados = new Map<string, ProgresoModulo>();

  for (const modulo of modulos) {
    const omision = omitidos.find((o) => esDelModulo(o, modulo));
    const hecho = hechos.some((h) => esDelModulo(h, modulo));

    let estado: EstadoModulo = "pendiente";
    if (hecho) estado = "completado";
    else if (omision) estado = "omitido";

    estados.set(modulo.id, {
      estado,
      ...(omision ? { motivoOmision: omision.motivo } : {}),
    });
  }

  return estados;
}

/**
 * ¿Está la marca terminada? Todos sus módulos completados u omitidos.
 *
 * Espeja `levantamientoCompleto` de `pasos-levantamiento.ts`, pero sobre el
 * mapa de estados en vez de sobre dos `Set`. Se queda aquí y aquel se retira:
 * dos formas de preguntar lo mismo divergen a la primera corrección.
 */
export function marcaCompleta(estados: Map<string, ProgresoModulo>): boolean {
  if (estados.size === 0) return false;
  return [...estados.values()].every((e) => e.estado !== "pendiente");
}
