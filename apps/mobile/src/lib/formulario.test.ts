import type { CampoFormulario } from "@market-track/shared";
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

  it("un entero no numérico cae a 0", () => {
    expect(coercionValorRespuesta(campo({ tipo: "entero" }), "abc")).toBe(0);
  });

  it("interpreta el booleano", () => {
    expect(coercionValorRespuesta(campo({ tipo: "booleano" }), true)).toBe(
      true,
    );
    expect(coercionValorRespuesta(campo({ tipo: "booleano" }), false)).toBe(
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
