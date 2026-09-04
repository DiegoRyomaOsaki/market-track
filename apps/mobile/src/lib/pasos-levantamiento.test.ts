import type { DefinicionFormulario } from "@market-track/shared";
import { describe, expect, it } from "@jest/globals";

import { construirPasos, PASOS } from "./pasos-levantamiento";

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
