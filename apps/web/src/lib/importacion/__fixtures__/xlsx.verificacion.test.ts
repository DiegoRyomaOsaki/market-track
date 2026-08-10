import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { construirXlsx } from "./xlsx";

// El generador de fixtures se prueba a sí mismo: si `conSharedStrings: false`
// produjera igualmente un `sharedStrings.xml`, el test de regresión del parseo
// sería un falso verde — estaría comprobando el formato fácil dos veces.

const HOJA = {
  nombre: "marca",
  filas: [
    ["codigo_externo", "nombre"],
    ["MRC", "Maracumango"],
  ],
};

function partes(buf: Buffer) {
  const zip = unzipSync(new Uint8Array(buf));
  return {
    nombres: Object.keys(zip),
    hoja: new TextDecoder().decode(zip["xl/worksheets/sheet1.xml"]),
  };
}

describe("el generador de .xlsx de prueba", () => {
  it("con sharedStrings mete el archivo y referencia índices", () => {
    const { nombres, hoja } = partes(construirXlsx([HOJA]));
    expect(nombres).toContain("xl/sharedStrings.xml");
    expect(hoja).toContain('t="s"');
    expect(hoja).not.toContain("inlineStr");
  });

  it("sin sharedStrings NO mete el archivo y escribe el texto en la celda", () => {
    const { nombres, hoja } = partes(
      construirXlsx([HOJA], { conSharedStrings: false }),
    );
    expect(nombres).not.toContain("xl/sharedStrings.xml");
    expect(hoja).toContain("inlineStr");
    expect(hoja).toContain("<is><t>Maracumango</t></is>");
  });
});
