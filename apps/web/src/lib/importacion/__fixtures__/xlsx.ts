import { zipSync, strToU8 } from "fflate";

// Un generador de .xlsx mínimos para los tests. Se escribe a mano en vez de
// añadir una librería de ESCRITURA: solo hacen falta unas pocas celdas, y una
// dependencia más para los tests es una dependencia más que auditar.
//
// Genera los DOS formatos que existen en la práctica, porque la diferencia entre
// ellos es exactamente lo que rompe la versión 9.x de `read-excel-file`:
//
//   - con `sharedStrings.xml`: lo que produce Excel de escritorio
//   - con `<is><t>` (inline strings): lo que produce Apache POI en streaming, es
//     decir, el exportador típico de un ERP
//
// El segundo es el caso que motivó fijar la librería en 5.8.8.

export type HojaFixture = { nombre: string; filas: (string | number)[][] };

const RELS_RAIZ = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

function contentTypes(hojas: HojaFixture[], conSharedStrings: boolean): string {
  const sheets = hojas
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");
  const shared = conSharedStrings
    ? `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets}${shared}</Types>`;
}

function workbook(hojas: HojaFixture[]): string {
  const sheets = hojas
    .map(
      (h, i) =>
        `<sheet name="${h.nombre}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets}</sheets></workbook>`;
}

function relsWorkbook(hojas: HojaFixture[], conSharedStrings: boolean): string {
  const rels = hojas
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join("");
  const shared = conSharedStrings
    ? `<Relationship Id="rIdSS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}${shared}</Relationships>`;
}

function escapar(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** La referencia de celda al estilo A1, B1… */
function ref(columna: number, fila: number): string {
  let n = columna;
  let letras = "";
  do {
    letras = String.fromCharCode(65 + (n % 26)) + letras;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${letras}${fila + 1}`;
}

function hojaXml(
  hoja: HojaFixture,
  indiceDe: ((texto: string) => number) | null,
): string {
  const filas = hoja.filas
    .map((fila, f) => {
      const celdas = fila
        .map((valor, c) => {
          const r = ref(c, f);
          if (typeof valor === "number") {
            return `<c r="${r}"><v>${valor}</v></c>`;
          }
          if (indiceDe === null) {
            // Inline string: SIN `sharedStrings.xml`. Este es el formato que hace
            // crashear a la 9.x de `read-excel-file`.
            return `<c r="${r}" t="inlineStr"><is><t>${escapar(valor)}</t></is></c>`;
          }
          return `<c r="${r}" t="s"><v>${indiceDe(valor)}</v></c>`;
        })
        .join("");
      return `<row r="${f + 1}">${celdas}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${filas}</sheetData></worksheet>`;
}

/**
 * Arma un .xlsx en memoria.
 *
 * `conSharedStrings: false` produce el formato de inline strings, que es el que
 * mandan los ERP y el que hay que seguir soportando.
 */
export function construirXlsx(
  hojas: HojaFixture[],
  { conSharedStrings = true }: { conSharedStrings?: boolean } = {},
): Buffer {
  const textos: string[] = [];
  const indice = new Map<string, number>();
  const indiceDe = (t: string) => {
    const ya = indice.get(t);
    if (ya !== undefined) return ya;
    indice.set(t, textos.length);
    textos.push(t);
    return textos.length - 1;
  };

  const archivos: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes(hojas, conSharedStrings)),
    "_rels/.rels": strToU8(RELS_RAIZ),
    "xl/workbook.xml": strToU8(workbook(hojas)),
    "xl/_rels/workbook.xml.rels": strToU8(
      relsWorkbook(hojas, conSharedStrings),
    ),
  };

  hojas.forEach((hoja, i) => {
    archivos[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(
      hojaXml(hoja, conSharedStrings ? indiceDe : null),
    );
  });

  if (conSharedStrings) {
    const items = textos.map((t) => `<si><t>${escapar(t)}</t></si>`).join("");
    archivos["xl/sharedStrings.xml"] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${textos.length}" uniqueCount="${textos.length}">${items}</sst>`,
    );
  }

  return Buffer.from(zipSync(archivos));
}
