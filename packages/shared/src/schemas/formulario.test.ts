import { describe, expect, it } from "vitest";

import { definicionFormularioSchema, TOPES_FORMULARIO } from "./formulario";

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

/** Un formulario de un paso con el campo que se quiera probar. */
function conCampo(campo: Record<string, unknown>) {
  return {
    pasos: [{ id: "p1", titulo: "X", orden: 0, campos: [campo] }],
  };
}

describe("rango numérico", () => {
  it("rechaza min mayor que max", () => {
    // El agujero que motivó este ticket: el constructor sí lo comprobaba, pero
    // solo para apagar el botón. Quien llamara a `publicarFormulario` por otra
    // vía publicaba un rango imposible, y el móvil guardaba un valor por encima
    // del máximo del propio campo.
    expect(() =>
      definicionFormularioSchema.parse(
        conCampo({ id: "n", tipo: "entero", etiqueta: "N", min: 10, max: 5 }),
      ),
    ).toThrow();
  });

  it("acepta min igual a max: un rango de un solo valor es legítimo", () => {
    expect(() =>
      definicionFormularioSchema.parse(
        conCampo({ id: "n", tipo: "entero", etiqueta: "N", min: 5, max: 5 }),
      ),
    ).not.toThrow();
  });

  it("acepta un extremo suelto: sin el otro no hay rango que invertir", () => {
    expect(() =>
      definicionFormularioSchema.parse(
        conCampo({ id: "a", tipo: "decimal", etiqueta: "A", min: 10 }),
      ),
    ).not.toThrow();
    expect(() =>
      definicionFormularioSchema.parse(
        conCampo({ id: "b", tipo: "decimal", etiqueta: "B", max: 5 }),
      ),
    ).not.toThrow();
  });

  it("acepta rangos negativos bien ordenados", () => {
    expect(() =>
      definicionFormularioSchema.parse(
        conCampo({
          id: "n",
          tipo: "decimal",
          etiqueta: "N",
          min: -10,
          max: -5,
        }),
      ),
    ).not.toThrow();
  });
});

describe("topes de tamaño", () => {
  // Una definición publicada se replica a cada teléfono: sin cota, una fila
  // puede crecer hasta hacer inviable la sincronización en un gama media.

  it("rechaza más pasos de los permitidos", () => {
    const pasos = Array.from(
      { length: TOPES_FORMULARIO.pasos + 1 },
      (_, i) => ({
        id: `p${i}`,
        titulo: `Paso ${i}`,
        orden: i,
        campos: [],
      }),
    );
    expect(() => definicionFormularioSchema.parse({ pasos })).toThrow();
  });

  it("acepta exactamente el tope de pasos", () => {
    const pasos = Array.from({ length: TOPES_FORMULARIO.pasos }, (_, i) => ({
      id: `p${i}`,
      titulo: `Paso ${i}`,
      orden: i,
      campos: [],
    }));
    expect(() => definicionFormularioSchema.parse({ pasos })).not.toThrow();
  });

  it("rechaza más campos de los permitidos en un paso", () => {
    const campos = Array.from(
      { length: TOPES_FORMULARIO.camposPorPaso + 1 },
      (_, i) => ({ id: `c${i}`, tipo: "texto", etiqueta: `C${i}` }),
    );
    expect(() =>
      definicionFormularioSchema.parse({
        pasos: [{ id: "p1", titulo: "X", orden: 0, campos }],
      }),
    ).toThrow();
  });

  it("rechaza más opciones de las permitidas", () => {
    const opciones = Array.from(
      { length: TOPES_FORMULARIO.opcionesPorCampo + 1 },
      (_, i) => `Opción ${i}`,
    );
    expect(() =>
      definicionFormularioSchema.parse(
        conCampo({ id: "s", tipo: "seleccion", etiqueta: "S", opciones }),
      ),
    ).toThrow();
  });

  it("rechaza una etiqueta más larga que el tope", () => {
    expect(() =>
      definicionFormularioSchema.parse(
        conCampo({
          id: "c",
          tipo: "texto",
          etiqueta: "x".repeat(TOPES_FORMULARIO.etiquetaChars + 1),
        }),
      ),
    ).toThrow();
  });

  it("rechaza una ayuda más larga que el tope", () => {
    expect(() =>
      definicionFormularioSchema.parse(
        conCampo({
          id: "c",
          tipo: "texto",
          etiqueta: "C",
          ayuda: "x".repeat(TOPES_FORMULARIO.ayudaChars + 1),
        }),
      ),
    ).toThrow();
  });

  it("rechaza un id más largo que el tope", () => {
    expect(() =>
      definicionFormularioSchema.parse(
        conCampo({
          id: "x".repeat(TOPES_FORMULARIO.idChars + 1),
          tipo: "texto",
          etiqueta: "C",
        }),
      ),
    ).toThrow();
  });

  it("rechaza una opción más larga que el tope", () => {
    expect(() =>
      definicionFormularioSchema.parse(
        conCampo({
          id: "s",
          tipo: "seleccion",
          etiqueta: "S",
          opciones: ["x".repeat(TOPES_FORMULARIO.opcionChars + 1)],
        }),
      ),
    ).toThrow();
  });

  it("rechaza un título de paso más largo que el tope", () => {
    expect(() =>
      definicionFormularioSchema.parse({
        pasos: [
          {
            id: "p1",
            titulo: "x".repeat(TOPES_FORMULARIO.etiquetaChars + 1),
            orden: 0,
            campos: [],
          },
        ],
      }),
    ).toThrow();
  });
});
