import { describe, expect, it } from "vitest";

import {
  definicionFormularioSchema,
  excedeTamano,
  recortarRespuesta,
  topeDeTexto,
  TOPES_FORMULARIO,
  TOPES_RESPUESTA,
} from "./formulario";

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

  // Cada tope se prueba en su valor EXACTO además de en el que lo supera: sin
  // esto, un `.max(tope - 1)` pasaría toda la batería de arriba sin que nadie
  // se enterara de que el límite real es otro.
  it("acepta exactamente el tope de campos en un paso", () => {
    const campos = Array.from(
      { length: TOPES_FORMULARIO.camposPorPaso },
      (_, i) => ({ id: `c${i}`, tipo: "texto", etiqueta: `C${i}` }),
    );
    expect(() =>
      definicionFormularioSchema.parse({
        pasos: [{ id: "p1", titulo: "X", orden: 0, campos }],
      }),
    ).not.toThrow();
  });

  it("acepta exactamente el tope de opciones", () => {
    const opciones = Array.from(
      { length: TOPES_FORMULARIO.opcionesPorCampo },
      (_, i) => `Opción ${i}`,
    );
    expect(() =>
      definicionFormularioSchema.parse(
        conCampo({ id: "s", tipo: "seleccion", etiqueta: "S", opciones }),
      ),
    ).not.toThrow();
  });

  it("acepta textos de exactamente la longitud del tope", () => {
    expect(() =>
      definicionFormularioSchema.parse({
        pasos: [
          {
            id: "p".repeat(TOPES_FORMULARIO.idChars),
            titulo: "t".repeat(TOPES_FORMULARIO.etiquetaChars),
            orden: 0,
            campos: [
              {
                id: "c".repeat(TOPES_FORMULARIO.idChars),
                tipo: "seleccion",
                etiqueta: "e".repeat(TOPES_FORMULARIO.etiquetaChars),
                ayuda: "a".repeat(TOPES_FORMULARIO.ayudaChars),
                opciones: ["o".repeat(TOPES_FORMULARIO.opcionChars)],
              },
            ],
          },
        ],
      }),
    ).not.toThrow();
  });
});

describe("tope de tamaño total", () => {
  // Los topes por pieza multiplicados dan varios MB: el techo global es el que
  // de verdad protege la réplica del teléfono.

  it("rechaza una definición que supera el techo aunque cada pieza quepa", () => {
    // Cada campo es legal por separado; lo que no cabe es la suma.
    const campos = Array.from(
      { length: TOPES_FORMULARIO.camposPorPaso },
      (_, i) => ({
        id: `c${i}`,
        tipo: "seleccion",
        etiqueta: "e".repeat(TOPES_FORMULARIO.etiquetaChars),
        ayuda: "a".repeat(TOPES_FORMULARIO.ayudaChars),
        opciones: Array.from(
          { length: TOPES_FORMULARIO.opcionesPorCampo },
          () => "o".repeat(TOPES_FORMULARIO.opcionChars),
        ),
      }),
    );
    const pasos = Array.from({ length: TOPES_FORMULARIO.pasos }, (_, p) => ({
      id: `p${p}`,
      titulo: "T",
      orden: p,
      campos: campos.map((c) => ({ ...c, id: `p${p}_${c.id}` })),
    }));
    expect(() => definicionFormularioSchema.parse({ pasos })).toThrow();
  });

  it("un formulario realista queda muy por debajo del techo", () => {
    const pasos = Array.from({ length: 5 }, (_, p) => ({
      id: `p${p}`,
      titulo: `Paso ${p}`,
      orden: p,
      campos: Array.from({ length: 8 }, (_, c) => ({
        id: `p${p}_c${c}`,
        tipo: "texto",
        etiqueta: `Campo ${c}`,
      })),
    }));
    expect(() => definicionFormularioSchema.parse({ pasos })).not.toThrow();
    expect(excedeTamano({ pasos })).toBe(false);
  });

  it("mide bytes, no caracteres: un acento cuenta doble", () => {
    // Importa porque el `check` de la tabla mide bytes con pg_column_size. Si
    // aquí se contaran caracteres, Zod dejaría pasar filas que la base rechaza.
    const soloAscii = "a".repeat(TOPES_FORMULARIO.bytesTotal - 20);
    const conAcentos = "á".repeat(TOPES_FORMULARIO.bytesTotal - 20);
    expect(excedeTamano(soloAscii)).toBe(false);
    expect(excedeTamano(conAcentos)).toBe(true);
  });
});

describe("topeDeTexto", () => {
  // El párrafo admite más que una línea de texto, y todo lo demás que guarde una
  // cadena se trata como texto corto. La respuesta de una foto ya no pasa por
  // aquí (el móvil la valida como uuid), pero la función sigue siendo total
  // sobre la unión de tipos: `foto` conserva un tope definido.

  it("el párrafo admite más que el texto corto", () => {
    expect(topeDeTexto("parrafo")).toBe(TOPES_RESPUESTA.parrafoChars);
    expect(topeDeTexto("texto")).toBe(TOPES_RESPUESTA.textoChars);
    expect(TOPES_RESPUESTA.parrafoChars).toBeGreaterThan(
      TOPES_RESPUESTA.textoChars,
    );
  });

  it("los demás tipos que guardan cadena caen en el tope corto", () => {
    expect(topeDeTexto("foto")).toBe(TOPES_RESPUESTA.textoChars);
    expect(topeDeTexto("seleccion")).toBe(TOPES_RESPUESTA.textoChars);
  });
});

describe("recortarRespuesta", () => {
  // Medida INDEPENDIENTE de la del código: si el test usara el mismo contador
  // que la implementación, se estaría verificando a sí mismo. `packages/shared`
  // es isomorfo y no tiene `Buffer` ni `TextEncoder`, así que se cuenta por la
  // vía estándar: cada byte no-ASCII sale como %XX de `encodeURIComponent`.
  const bytes = (s: string) =>
    encodeURIComponent(s).replace(/%[0-9A-F]{2}/gi, "x").length;

  it("deja intacto lo que ya cabe", () => {
    expect(recortarRespuesta("Todo bien", "texto")).toBe("Todo bien");
  });

  it("respeta el tope de caracteres del tipo", () => {
    const largo = "x".repeat(TOPES_RESPUESTA.textoChars + 100);
    expect(recortarRespuesta(largo, "texto")).toHaveLength(
      TOPES_RESPUESTA.textoChars,
    );
  });

  it("manda el tope de BYTES cuando corta antes que el de caracteres", () => {
    // 10.000 caracteres acentuados caben en `parrafoChars` pero son 20.000
    // bytes: por encima del techo. El recorte tiene que mirar los dos.
    const acentos = "ñ".repeat(TOPES_RESPUESTA.parrafoChars);
    const r = recortarRespuesta(acentos, "parrafo");
    expect(bytes(r)).toBeLessThanOrEqual(TOPES_RESPUESTA.bytes);
    expect(r.length).toBeLessThan(TOPES_RESPUESTA.parrafoChars);
  });

  it("no deja un surrogate suelto al cortar entre un par", () => {
    // Con `.slice()` el último carácter quedaría partido y al serializar se
    // volvería U+FFFD: la respuesta no se corta, se corrompe.
    const emojis = "😀".repeat(TOPES_RESPUESTA.parrafoChars);
    const r = recortarRespuesta(emojis, "parrafo");
    expect([...r].every((c) => c === "😀")).toBe(true);
    expect(bytes(r)).toBeLessThanOrEqual(TOPES_RESPUESTA.bytes);
  });

  it("lo que recorta siempre cabe bajo el techo de la tabla", () => {
    // La garantía que sostiene todo: el `check` de `levantamiento_respuesta`
    // permite 16 KB y el recorte deja 12 KB, así que lo que la app guarda la
    // base lo acepta — con acentos, con emojis o con lo que sea.
    for (const relleno of ["x", "ñ", "😀", "漢"]) {
      const r = recortarRespuesta(relleno.repeat(20000), "parrafo");
      expect(bytes(r)).toBeLessThanOrEqual(TOPES_RESPUESTA.bytes);
    }
  });
});
