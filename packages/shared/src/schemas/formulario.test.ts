import { describe, expect, it } from "vitest";

import { definicionFormularioSchema } from "./formulario";

const valida = {
  pasos: [
    {
      id: "p1",
      titulo: "Datos extra",
      orden: 0,
      campos: [
        { id: "temperatura", tipo: "decimal", etiqueta: "Temperatura", min: 0 },
        {
          id: "estado_gondola",
          tipo: "seleccion",
          etiqueta: "Estado de la góndola",
          obligatorio: true,
          opciones: ["Buena", "Regular", "Mala"],
        },
      ],
    },
  ],
};

describe("definicionFormularioSchema", () => {
  it("acepta una definición válida y aplica el default de obligatorio", () => {
    const r = definicionFormularioSchema.parse(valida);
    expect(r.pasos[0]?.campos[0]?.obligatorio).toBe(false);
  });

  it("rechaza un campo de selección sin opciones", () => {
    expect(() =>
      definicionFormularioSchema.parse({
        pasos: [
          {
            id: "p1",
            titulo: "X",
            orden: 0,
            campos: [{ id: "c", tipo: "seleccion", etiqueta: "C" }],
          },
        ],
      }),
    ).toThrow();
  });

  it("rechaza id de campo duplicados en todo el formulario", () => {
    expect(() =>
      definicionFormularioSchema.parse({
        pasos: [
          {
            id: "p1",
            titulo: "A",
            orden: 0,
            campos: [{ id: "dup", tipo: "texto", etiqueta: "A" }],
          },
          {
            id: "p2",
            titulo: "B",
            orden: 1,
            campos: [{ id: "dup", tipo: "texto", etiqueta: "B" }],
          },
        ],
      }),
    ).toThrow();
  });

  it("rechaza una definición sin pasos", () => {
    expect(() => definicionFormularioSchema.parse({ pasos: [] })).toThrow();
  });
});
