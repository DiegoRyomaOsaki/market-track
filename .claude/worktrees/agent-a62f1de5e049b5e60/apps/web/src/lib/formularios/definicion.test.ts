import { describe, expect, it } from "vitest";

import { definicionFormularioSchema } from "@market-track/shared";

import {
  type PasoEditable,
  construirDefinicion,
  definicionADraft,
  opcionesDeTexto,
  problemasDeDefinicion,
} from "./definicion";

function campo(over: Partial<PasoEditable["campos"][number]> = {}) {
  return {
    id: "c1",
    tipo: "texto" as const,
    etiqueta: "Nombre",
    obligatorio: false,
    ayuda: "",
    opcionesTexto: "",
    min: "",
    max: "",
    ...over,
  };
}

function paso(over: Partial<PasoEditable> = {}): PasoEditable {
  return { id: "p1", titulo: "Paso", campos: [campo()], ...over };
}

describe("opcionesDeTexto", () => {
  it("parte por líneas, recorta y descarta vacíos", () => {
    expect(opcionesDeTexto(" Buena \n\n Regular \nMala\n")).toEqual([
      "Buena",
      "Regular",
      "Mala",
    ]);
  });
});

describe("construirDefinicion", () => {
  it("deriva el orden del índice del paso", () => {
    const d = construirDefinicion([paso({ id: "a" }), paso({ id: "b" })]);
    expect(d.pasos.map((p) => p.orden)).toEqual([0, 1]);
  });

  it("solo emite opciones para los tipos de selección", () => {
    const d = construirDefinicion([
      paso({
        campos: [
          campo({
            id: "s",
            tipo: "seleccion",
            etiqueta: "E",
            opcionesTexto: "A\nB",
          }),
          campo({
            id: "t",
            tipo: "texto",
            etiqueta: "T",
            opcionesTexto: "A\nB",
          }),
        ],
      }),
    ]);
    expect(d.pasos[0]?.campos[0]).toMatchObject({ opciones: ["A", "B"] });
    expect(d.pasos[0]?.campos[1]).not.toHaveProperty("opciones");
  });

  it("solo emite mín/máx numéricos y omite los vacíos", () => {
    const d = construirDefinicion([
      paso({
        campos: [
          campo({ id: "n", tipo: "entero", etiqueta: "N", min: "1", max: "" }),
        ],
      }),
    ]);
    expect(d.pasos[0]?.campos[0]).toMatchObject({ min: 1 });
    expect(d.pasos[0]?.campos[0]).not.toHaveProperty("max");
  });

  it("produce una definición que el esquema canónico acepta", () => {
    const d = construirDefinicion([
      paso({ titulo: "Datos", campos: [campo({ etiqueta: "Temperatura" })] }),
    ]);
    expect(definicionFormularioSchema.safeParse(d).success).toBe(true);
  });

  it("un campo foto no arrastra opciones ni mín/máx de un cambio de tipo", () => {
    // El admin elige "Selección", teclea opciones, y cambia el tipo a "Foto":
    // el estado del editor conserva los restos, la definición no debe emitirlos.
    const d = construirDefinicion([
      paso({
        campos: [
          campo({
            id: "f",
            tipo: "foto",
            etiqueta: "Foto de la góndola",
            obligatorio: true,
            opcionesTexto: "A\nB",
            min: "1",
            max: "5",
          }),
        ],
      }),
    ]);
    const emitido = d.pasos[0]?.campos[0];
    expect(emitido).toMatchObject({ tipo: "foto", obligatorio: true });
    expect(emitido).not.toHaveProperty("opciones");
    expect(emitido).not.toHaveProperty("min");
    expect(emitido).not.toHaveProperty("max");
    expect(definicionFormularioSchema.safeParse(d).success).toBe(true);
  });
});

describe("definicionADraft", () => {
  it("ordena los pasos por `orden` y rellena los textos editables", () => {
    const draft = definicionADraft({
      pasos: [
        {
          id: "p2",
          titulo: "Segundo",
          orden: 1,
          campos: [
            {
              id: "c",
              tipo: "seleccion",
              etiqueta: "E",
              obligatorio: true,
              opciones: ["A"],
            },
          ],
        },
        { id: "p1", titulo: "Primero", orden: 0, campos: [] },
      ],
    });
    expect(draft.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(draft[1]?.campos[0]?.opcionesTexto).toBe("A");
  });

  it("es la inversa de construirDefinicion en la ida y vuelta", () => {
    const original = [
      paso({
        titulo: "Datos",
        campos: [
          campo({
            id: "temp",
            tipo: "decimal",
            etiqueta: "Temp",
            min: "0",
            max: "40",
          }),
        ],
      }),
    ];
    const ida = definicionADraft(construirDefinicion(original));
    expect(ida[0]?.campos[0]).toMatchObject({
      min: "0",
      max: "40",
      tipo: "decimal",
    });
  });
});

describe("problemasDeDefinicion", () => {
  it("no ve problemas en una definición completa", () => {
    expect(problemasDeDefinicion([paso({ titulo: "Datos" })])).toEqual([]);
  });

  it("exige al menos un paso", () => {
    expect(problemasDeDefinicion([])).toContain("Agrega al menos un paso.");
  });

  it("marca un paso sin título y un campo sin etiqueta", () => {
    const problemas = problemasDeDefinicion([
      paso({ titulo: "", campos: [campo({ etiqueta: "" })] }),
    ]);
    expect(problemas.some((p) => p.includes("necesita un título"))).toBe(true);
    expect(problemas.some((p) => p.includes("sin etiqueta"))).toBe(true);
  });

  it("exige opciones en un campo de selección", () => {
    const problemas = problemasDeDefinicion([
      paso({
        campos: [
          campo({ tipo: "seleccion", etiqueta: "Estado", opcionesTexto: "" }),
        ],
      }),
    ]);
    expect(
      problemas.some((p) => p.includes("necesita al menos una opción")),
    ).toBe(true);
  });

  it("detecta un rango numérico invertido", () => {
    const problemas = problemasDeDefinicion([
      paso({
        campos: [campo({ tipo: "entero", etiqueta: "N", min: "10", max: "2" })],
      }),
    ]);
    expect(
      problemas.some((p) => p.includes("mínimo es mayor que el máximo")),
    ).toBe(true);
  });

  // Las dos verjas —la del constructor, en lenguaje del admin, y la del servidor,
  // en Zod— tienen que dar el MISMO veredicto. Que divergieran es justo el bug
  // que arregló MAR-83: `min > max` apagaba el botón pero el esquema estricto lo
  // dejaba publicar. Este test las ata; si alguien añade una regla a un lado y
  // no al otro, se cae aquí en vez de en producción.
  it.each([
    [
      "selección sin opciones",
      [
        paso({
          campos: [
            campo({ tipo: "seleccion", etiqueta: "E", opcionesTexto: "" }),
          ],
        }),
      ],
    ],
    [
      "rango invertido",
      [
        paso({
          campos: [
            campo({ tipo: "entero", etiqueta: "N", min: "10", max: "5" }),
          ],
        }),
      ],
    ],
    ["campo sin etiqueta", [paso({ campos: [campo({ etiqueta: "" })] })]],
    [
      "definición válida",
      [paso({ campos: [campo({ tipo: "texto", etiqueta: "Nota" })] })],
    ],
    [
      "campo foto bien formado",
      [
        paso({
          campos: [
            campo({ tipo: "foto", etiqueta: "Góndola", obligatorio: true }),
          ],
        }),
      ],
    ],
  ])("coincide con el veredicto del esquema estricto: %s", (_caso, pasos) => {
    const hayProblemas = problemasDeDefinicion(pasos).length > 0;
    const estrictoRechaza = !definicionFormularioSchema.safeParse(
      construirDefinicion(pasos),
    ).success;
    expect(hayProblemas).toBe(estrictoRechaza);
  });
});
