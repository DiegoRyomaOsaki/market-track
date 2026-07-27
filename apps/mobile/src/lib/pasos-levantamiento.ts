import type { PasoLevantamiento } from "@market-track/shared";

// Los 5 pasos del levantamiento secuencial por marca (docs/04, Módulo 2). El
// contenido de cada paso lo implementan MAR-37 (Antes + Share of Shelf) y MAR-38
// (quiebres, precios, exhibiciones, Después); MAR-36 es el SHELL: navegación
// secuencial, barra de progreso y la contingencia (bypass) en cada paso.
//
// `paso` es el valor del enum que viaja en la contingencia (paso_levantamiento).

export type PasoWizard = {
  id: string;
  titulo: string;
  descripcion: string;
  paso: PasoLevantamiento;
};

export const PASOS: readonly PasoWizard[] = [
  {
    id: "antes",
    titulo: "Antes y Share of Shelf",
    descripcion: "Foto de la góndola y frentes propios vs. competencia.",
    paso: "foto_antes",
  },
  {
    id: "quiebres",
    titulo: "Quiebres y diferencias",
    descripcion: "Stock de sistema vs. piso por SKU.",
    paso: "quiebres",
  },
  {
    id: "precios",
    titulo: "Precios",
    descripcion: "Precio en tienda por SKU y estado de la promoción.",
    paso: "precios",
  },
  {
    id: "exhibiciones",
    titulo: "Exhibiciones",
    descripcion: "Exhibiciones negociadas y material POP.",
    paso: "exhibiciones",
  },
  {
    id: "despues",
    titulo: "Foto Después",
    descripcion: "Foto de la góndola ya trabajada.",
    paso: "foto_despues",
  },
];

/** ¿Está el levantamiento terminado? Todos los pasos hechos u omitidos. */
export function levantamientoCompleto(
  hechos: ReadonlySet<string>,
  omitidos: ReadonlySet<string>,
): boolean {
  return PASOS.every((p) => hechos.has(p.id) || omitidos.has(p.id));
}
