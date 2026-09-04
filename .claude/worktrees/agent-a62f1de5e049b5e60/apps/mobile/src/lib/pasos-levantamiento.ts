import type {
  CampoFormulario,
  DefinicionFormulario,
  PasoLevantamiento,
} from "@market-track/shared";

// Los pasos del wizard de levantamiento por marca (docs/04, Módulo 2). Cinco
// pasos FIJOS con lógica de negocio —los implementan MAR-37/38, MAR-36 es el
// shell (secuencia + contingencia)— más los pasos CONFIGURABLES que aporta la
// definición del formulario (MAR-80, ADR-0010), insertados entre "exhibiciones"
// y "despues". Los configurables solo capturan campos libres; la secuencia
// obligatoria y el bypass los sigue garantizando el shell.
//
// `paso` es el valor del enum que viaja en la contingencia (paso_levantamiento).
// Todos los pasos configurables comparten 'campos_extra'; el shell distingue cuál
// es con el id del paso (contingencia.paso_config_id).

export const PASO_CONFIGURABLE = "campos_extra";

/** El `paso` que viaja en una contingencia: un paso fijo o el marcador de los
 * configurables. Los pasos configurables se distinguen por `paso_config_id`. */
export type PasoBypass = PasoLevantamiento | typeof PASO_CONFIGURABLE;

type IdPasoFijo = "antes" | "quiebres" | "precios" | "exhibiciones" | "despues";

export type PasoWizardFijo = {
  tipo: "fijo";
  id: IdPasoFijo;
  titulo: string;
  descripcion: string;
  paso: PasoLevantamiento;
};

export type PasoWizardConfigurable = {
  tipo: "configurable";
  id: string;
  titulo: string;
  descripcion: string;
  paso: typeof PASO_CONFIGURABLE;
  campos: CampoFormulario[];
};

export type PasoWizard = PasoWizardFijo | PasoWizardConfigurable;

export const PASOS: readonly PasoWizardFijo[] = [
  {
    tipo: "fijo",
    id: "antes",
    titulo: "Antes y Share of Shelf",
    descripcion: "Foto de la góndola y frentes propios vs. competencia.",
    paso: "foto_antes",
  },
  {
    tipo: "fijo",
    id: "quiebres",
    titulo: "Quiebres y diferencias",
    descripcion: "Stock de sistema vs. piso por SKU.",
    paso: "quiebres",
  },
  {
    tipo: "fijo",
    id: "precios",
    titulo: "Precios",
    descripcion: "Precio en tienda por SKU y estado de la promoción.",
    paso: "precios",
  },
  {
    tipo: "fijo",
    id: "exhibiciones",
    titulo: "Exhibiciones",
    descripcion: "Exhibiciones negociadas y material POP.",
    paso: "exhibiciones",
  },
  {
    tipo: "fijo",
    id: "despues",
    titulo: "Foto Después",
    descripcion: "Foto de la góndola ya trabajada.",
    paso: "foto_despues",
  },
];

const IDS_FIJOS = new Set<string>(PASOS.map((p) => p.id));

/**
 * Mezcla los pasos fijos con los configurables de la definición, insertando el
 * bloque configurable (ordenado por `orden`) ENTRE "exhibiciones" y "despues".
 * Sin definición → solo los 5 fijos (retrocompatible). Si un id configurable
 * choca con uno fijo, o se repite, la definición se descarta y se cae a los
 * fijos: los sets de hechos/omitidos se llavean por id y un choque los corrompe.
 */
export function construirPasos(
  definicion: DefinicionFormulario | null,
): PasoWizard[] {
  if (!definicion) return [...PASOS];

  const configurables: PasoWizardConfigurable[] = [...definicion.pasos]
    .sort((a, b) => a.orden - b.orden)
    .map((p) => ({
      tipo: "configurable",
      id: p.id,
      titulo: p.titulo,
      descripcion: "",
      paso: PASO_CONFIGURABLE,
      campos: p.campos,
    }));

  const ids = configurables.map((p) => p.id);
  const choca = ids.some((id) => IDS_FIJOS.has(id));
  const repetido = new Set(ids).size !== ids.length;
  if (choca || repetido) {
    console.warn(
      "[pasos] definición con ids de paso inválidos (choque o repetidos); se usan solo los pasos fijos",
    );
    return [...PASOS];
  }

  const corte = PASOS.findIndex((p) => p.id === "despues");
  return [...PASOS.slice(0, corte), ...configurables, ...PASOS.slice(corte)];
}

/** ¿Está el levantamiento terminado? Todos los pasos hechos u omitidos. */
export function levantamientoCompleto(
  pasos: readonly PasoWizard[],
  hechos: ReadonlySet<string>,
  omitidos: ReadonlySet<string>,
): boolean {
  return pasos.every((p) => hechos.has(p.id) || omitidos.has(p.id));
}
