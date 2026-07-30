import type { DefinicionFormulario } from "@market-track/shared";
import { describe, expect, it } from "@jest/globals";

import {
  construirPasos,
  levantamientoCompleto,
  PASOS,
} from "./pasos-levantamiento";

const idsFijos = PASOS.map((p) => p.id);

function definicion(
  pasos: DefinicionFormulario["pasos"],
): DefinicionFormulario {
  return { pasos };
}

const pasoConfig = (
  id: string,
  orden: number,
): DefinicionFormulario["pasos"][number] => ({
  id,
  titulo: `Paso ${id}`,
  orden,
  campos: [
    { id: `${id}_c`, tipo: "texto", etiqueta: "Nota", obligatorio: false },
  ],
});

describe("construirPasos", () => {
  it("sin definición devuelve solo los 5 pasos fijos, en orden", () => {
    expect(construirPasos(null).map((p) => p.id)).toEqual(idsFijos);
  });

  it("inserta los pasos configurables entre 'exhibiciones' y 'despues'", () => {
    const pasos = construirPasos(
      definicion([pasoConfig("extra_a", 0), pasoConfig("extra_b", 1)]),
    );
    expect(pasos.map((p) => p.id)).toEqual([
      "antes",
      "quiebres",
      "precios",
      "exhibiciones",
      "extra_a",
      "extra_b",
      "despues",
    ]);
  });

  it("ordena los configurables por `orden`, no por el orden del array", () => {
    const pasos = construirPasos(
      definicion([pasoConfig("segundo", 5), pasoConfig("primero", 1)]),
    );
    const configurables = pasos
      .filter((p) => p.tipo === "configurable")
      .map((p) => p.id);
    expect(configurables).toEqual(["primero", "segundo"]);
  });

  it("descarta la definición y usa los fijos si un id choca con uno fijo", () => {
    const pasos = construirPasos(definicion([pasoConfig("quiebres", 0)]));
    expect(pasos.map((p) => p.id)).toEqual(idsFijos);
  });

  it("descarta la definición si dos pasos configurables comparten id", () => {
    const pasos = construirPasos(
      definicion([pasoConfig("dup", 0), pasoConfig("dup", 1)]),
    );
    expect(pasos.map((p) => p.id)).toEqual(idsFijos);
  });
});

describe("levantamientoCompleto", () => {
  it("no está completo sin ningún paso hecho ni omitido", () => {
    expect(levantamientoCompleto(PASOS, new Set(), new Set())).toBe(false);
  });

  it("está completo cuando todos los pasos (fijos + configurables) están hechos", () => {
    const pasos = construirPasos(definicion([pasoConfig("extra", 0)]));
    const todos = new Set(pasos.map((p) => p.id));
    expect(levantamientoCompleto(pasos, todos, new Set())).toBe(true);
  });

  it("cuenta un paso configurable omitido por contingencia como cubierto", () => {
    const pasos = construirPasos(definicion([pasoConfig("extra", 0)]));
    const hechos = new Set(idsFijos);
    const omitidos = new Set(["extra"]);
    expect(levantamientoCompleto(pasos, hechos, omitidos)).toBe(true);
  });

  it("no está completo si falta un paso configurable por hacer u omitir", () => {
    const pasos = construirPasos(definicion([pasoConfig("extra", 0)]));
    expect(levantamientoCompleto(pasos, new Set(idsFijos), new Set())).toBe(
      false,
    );
  });
});
