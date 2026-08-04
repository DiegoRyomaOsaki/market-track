import { TOPES_RESPUESTA, type CampoFormulario } from "@market-track/shared";
import { describe, expect, it } from "@jest/globals";

import {
  coercionValorRespuesta,
  estaContestado,
  faltanObligatorios,
  parseDefinicionFormulario,
  resolverVersionAnclada,
} from "./formulario";

const DEF_VALIDA = JSON.stringify({
  pasos: [
    {
      id: "p1",
      titulo: "Datos extra",
      orden: 0,
      campos: [{ id: "temp", tipo: "decimal", etiqueta: "Temperatura" }],
    },
  ],
});

describe("parseDefinicionFormulario", () => {
  it("parsea y valida una definición correcta", () => {
    const d = parseDefinicionFormulario(DEF_VALIDA);
    expect(d?.pasos[0]?.campos[0]?.id).toBe("temp");
  });

  it("devuelve null ante null o cadena vacía", () => {
    expect(parseDefinicionFormulario(null)).toBeNull();
    expect(parseDefinicionFormulario("   ")).toBeNull();
  });

  it("devuelve null ante JSON roto (degrada a pasos fijos, no revienta)", () => {
    expect(parseDefinicionFormulario("{pasos:")).toBeNull();
  });

  it("devuelve null ante una definición inválida (selección sin opciones)", () => {
    const invalida = JSON.stringify({
      pasos: [
        {
          id: "p1",
          titulo: "X",
          orden: 0,
          campos: [{ id: "c", tipo: "seleccion", etiqueta: "Estado" }],
        },
      ],
    });
    expect(parseDefinicionFormulario(invalida)).toBeNull();
  });
});

describe("resolverVersionAnclada", () => {
  const marca = "m1";
  const formEspecifico = { id: "fe", marca_id: marca, creado_at: "2026-07-02" };
  const formTodas = { id: "ft", marca_id: null, creado_at: "2026-07-01" };

  it("prefiere el formulario específico de la marca sobre el de todas", () => {
    const v = resolverVersionAnclada(
      [formTodas, formEspecifico],
      [
        { id: "vt", formulario_id: "ft", version: 3 },
        { id: "ve", formulario_id: "fe", version: 1 },
      ],
      marca,
    );
    expect(v).toBe("ve");
  });

  it("usa el de todas las marcas cuando no hay uno específico", () => {
    const v = resolverVersionAnclada(
      [formTodas],
      [{ id: "vt", formulario_id: "ft", version: 1 }],
      marca,
    );
    expect(v).toBe("vt");
  });

  it("a igual especificidad, gana el formulario más reciente (no la versión más alta)", () => {
    const viejo = { id: "viejo", marca_id: marca, creado_at: "2026-07-01" };
    const nuevo = { id: "nuevo", marca_id: marca, creado_at: "2026-07-10" };
    const v = resolverVersionAnclada(
      [viejo, nuevo],
      [
        { id: "v_viejo", formulario_id: "viejo", version: 99 },
        { id: "v_nuevo", formulario_id: "nuevo", version: 1 },
      ],
      marca,
    );
    expect(v).toBe("v_nuevo");
  });

  it("elige la versión publicada más alta del formulario elegido", () => {
    const v = resolverVersionAnclada(
      [formTodas],
      [
        { id: "vt1", formulario_id: "ft", version: 1 },
        { id: "vt2", formulario_id: "ft", version: 2 },
      ],
      marca,
    );
    expect(v).toBe("vt2");
  });

  it("cae al de todas las marcas si el específico no tiene versión publicada", () => {
    const v = resolverVersionAnclada(
      [formTodas, formEspecifico],
      [{ id: "vt", formulario_id: "ft", version: 1 }],
      marca,
    );
    expect(v).toBe("vt");
  });

  it("devuelve null si no hay formulario para la marca", () => {
    expect(resolverVersionAnclada([], [], marca)).toBeNull();
  });
});

function campo(over: Partial<CampoFormulario> = {}): CampoFormulario {
  return { id: "c", tipo: "texto", etiqueta: "C", obligatorio: false, ...over };
}

describe("coercionValorRespuesta", () => {
  it("recorta el texto", () => {
    expect(coercionValorRespuesta(campo({ tipo: "texto" }), "  hola ")).toBe(
      "hola",
    );
  });

  it("trunca y acota un entero a su rango", () => {
    expect(
      coercionValorRespuesta(campo({ tipo: "entero", max: 10 }), "12.9"),
    ).toBe(10);
    expect(
      coercionValorRespuesta(campo({ tipo: "entero", min: 0 }), "-3"),
    ).toBe(0);
  });

  it("trunca el texto libre a su tope", () => {
    // Es la única cota entre el teclado del mercaderista y una tabla que se
    // replica a todos los teléfonos del cliente. Sin esto, una sesión
    // comprometida guarda megabytes por campo.
    const largo = "x".repeat(TOPES_RESPUESTA.textoChars + 500);
    const r = coercionValorRespuesta(campo({ tipo: "texto" }), largo);
    expect(typeof r === "string" && r.length).toBe(TOPES_RESPUESTA.textoChars);
  });

  it("el párrafo tiene su propio tope, más alto que el del texto", () => {
    const largo = "x".repeat(TOPES_RESPUESTA.parrafoChars + 500);
    const r = coercionValorRespuesta(campo({ tipo: "parrafo" }), largo);
    expect(typeof r === "string" && r.length).toBe(
      TOPES_RESPUESTA.parrafoChars,
    );
  });

  it("recorta espacios ANTES de medir: no se gasta el tope en blancos", () => {
    const conEspacios = "  " + "x".repeat(TOPES_RESPUESTA.textoChars) + "  ";
    const r = coercionValorRespuesta(campo({ tipo: "texto" }), conEspacios);
    expect(typeof r === "string" && r.length).toBe(TOPES_RESPUESTA.textoChars);
  });

  it("un texto dentro del tope no se toca", () => {
    expect(coercionValorRespuesta(campo({ tipo: "texto" }), "Todo bien")).toBe(
      "Todo bien",
    );
  });

  it("un texto de exactamente el tope no se recorta", () => {
    const justo = "x".repeat(TOPES_RESPUESTA.textoChars);
    expect(coercionValorRespuesta(campo({ tipo: "texto" }), justo)).toBe(justo);
  });

  it("un párrafo de acentos cabe en la base: se mide en bytes, no caracteres", () => {
    // 10.000 caracteres acentuados son 20.012 bytes —medido contra Postgres— y
    // el `check` de la tabla permite 16 KB. Recortando por caracteres, la app
    // guardaría algo que la base rechaza al sincronizar, y el mercaderista lo
    // descubriría horas después y fuera de la tienda.
    const acentos = "ñ".repeat(TOPES_RESPUESTA.parrafoChars);
    const r = coercionValorRespuesta(
      campo({ tipo: "parrafo" }),
      acentos,
    ) as string;
    expect(Buffer.byteLength(r, "utf8")).toBeLessThanOrEqual(
      TOPES_RESPUESTA.bytes,
    );
  });

  it("no parte un emoji por la mitad", () => {
    // Cortar por unidades UTF-16 dejaría un surrogate suelto, que al serializar
    // se vuelve U+FFFD: la respuesta no se cortaría, se corrompería en su último
    // carácter.
    const emojis = "😀".repeat(TOPES_RESPUESTA.parrafoChars);
    const r = coercionValorRespuesta(
      campo({ tipo: "parrafo" }),
      emojis,
    ) as string;
    expect([...r].every((c) => c === "😀")).toBe(true);
    expect(Buffer.byteLength(r, "utf8")).toBeLessThanOrEqual(
      TOPES_RESPUESTA.bytes,
    );
  });

  it("la selección múltiple no admite la misma opción repetida", () => {
    const c = campo({ tipo: "seleccion_multiple", opciones: ["A", "B"] });
    expect(coercionValorRespuesta(c, ["A", "A", "A", "B"])).toEqual(["A", "B"]);
  });

  it("un entero no numérico cae a 0", () => {
    expect(coercionValorRespuesta(campo({ tipo: "entero" }), "abc")).toBe(0);
  });

  it("con un rango invertido nunca devuelve por encima del máximo", () => {
    // {min:10, max:5} ya no se puede publicar —el esquema estricto lo rechaza—
    // pero puede venir en una definición guardada antes de esa verja. Antes se
    // devolvía 10: por encima del máximo que declara el propio campo, o sea un
    // dato que contradice al formulario que lo pidió.
    expect(
      coercionValorRespuesta(campo({ tipo: "entero", min: 10, max: 5 }), "3"),
    ).toBe(5);
    expect(
      coercionValorRespuesta(
        campo({ tipo: "decimal", min: 10, max: 5 }),
        "7.5",
      ),
    ).toBe(5);
  });

  it("el decimal conserva los decimales y acota al rango", () => {
    expect(coercionValorRespuesta(campo({ tipo: "decimal" }), "4.5")).toBe(4.5);
    expect(
      coercionValorRespuesta(campo({ tipo: "decimal", max: 10 }), "12.5"),
    ).toBe(10);
    expect(coercionValorRespuesta(campo({ tipo: "decimal" }), "abc")).toBe(0);
  });

  it("interpreta el booleano desde bool, cadena 'true' o 1", () => {
    expect(coercionValorRespuesta(campo({ tipo: "booleano" }), true)).toBe(
      true,
    );
    expect(coercionValorRespuesta(campo({ tipo: "booleano" }), false)).toBe(
      false,
    );
    expect(coercionValorRespuesta(campo({ tipo: "booleano" }), "true")).toBe(
      true,
    );
    expect(coercionValorRespuesta(campo({ tipo: "booleano" }), 1)).toBe(true);
    expect(coercionValorRespuesta(campo({ tipo: "booleano" }), "no")).toBe(
      false,
    );
  });

  it("descarta una selección fuera de las opciones", () => {
    const c = campo({ tipo: "seleccion", opciones: ["A", "B"] });
    expect(coercionValorRespuesta(c, "B")).toBe("B");
    expect(coercionValorRespuesta(c, "Z")).toBe("");
  });

  it("acota la selección múltiple a las opciones válidas", () => {
    const c = campo({ tipo: "seleccion_multiple", opciones: ["A", "B"] });
    expect(coercionValorRespuesta(c, ["A", "Z", "B"])).toEqual(["A", "B"]);
  });
});

describe("estaContestado / faltanObligatorios", () => {
  it("un texto en blanco no cuenta como contestado", () => {
    expect(estaContestado("  ")).toBe(false);
    expect(estaContestado("x")).toBe(true);
  });

  it("una lista vacía no cuenta; un booleano sí (presente)", () => {
    expect(estaContestado([])).toBe(false);
    expect(estaContestado(["A"])).toBe(true);
    expect(estaContestado(false)).toBe(true);
  });

  it("falta un obligatorio sin contestar, pero no si es opcional", () => {
    const campos = [
      campo({ id: "req", obligatorio: true }),
      campo({ id: "opt", obligatorio: false }),
    ];
    expect(faltanObligatorios(campos, {})).toBe(true);
    expect(faltanObligatorios(campos, { req: "listo" })).toBe(false);
  });
});
