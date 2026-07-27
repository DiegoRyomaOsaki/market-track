import { describe, expect, it } from "@jest/globals";

import { levantamientoCompleto, PASOS } from "./pasos-levantamiento";

const todos = PASOS.map((p) => p.id);

describe("levantamientoCompleto", () => {
  it("no está completo sin ningún paso hecho ni omitido", () => {
    expect(levantamientoCompleto(new Set(), new Set())).toBe(false);
  });

  it("está completo cuando todos los pasos están hechos", () => {
    expect(levantamientoCompleto(new Set(todos), new Set())).toBe(true);
  });

  it("cuenta los pasos omitidos por contingencia como cubiertos", () => {
    const hechos = new Set(todos.slice(0, -1));
    const omitidos = new Set([todos[todos.length - 1]!]);
    expect(levantamientoCompleto(hechos, omitidos)).toBe(true);
  });

  it("no está completo si falta un paso por hacer u omitir", () => {
    const hechos = new Set(todos.slice(0, -1));
    expect(levantamientoCompleto(hechos, new Set())).toBe(false);
  });
});
