import { describe, expect, it, vi } from "vitest";

import { construirXlsx } from "./xlsx";
import { hojasPresentes, parsearMaestro } from "./parseo";

// El parseo del .xlsx. El test que más importa aquí es el de inline strings: es
// la regresión que motivó fijar `read-excel-file` en 5.8.8, y la red que permite
// intentar subir de versión algún día.

const MARCAS = {
  nombre: "marca",
  filas: [
    ["codigo_externo", "nombre", "tolerancia_precio_pct"],
    ["MRC", "Maracumango", 5],
  ],
};

describe("parsearMaestro", () => {
  it("lee un .xlsx normal, con sharedStrings", () => {
    // Lo que produce Excel de escritorio.
    return parsearMaestro(construirXlsx([MARCAS])).then((r) => {
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.hojas.marca?.[1]).toEqual(["MRC", "Maracumango", 5]);
    });
  });

  it("lee un .xlsx con INLINE STRINGS, sin sharedStrings", async () => {
    // Es lo que produce Apache POI en modo streaming — el exportador típico de un
    // ERP, o sea el archivo que manda un cliente de verdad. La versión 9.x de la
    // librería revienta aquí con «readFiles(...).then is not a function», y por
    // eso está fijada la 5.8.8. Si este test se pone rojo tras una actualización,
    // la actualización es la culpable.
    const r = await parsearMaestro(
      construirXlsx([MARCAS], { conSharedStrings: false }),
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hojas.marca?.[1]).toEqual(["MRC", "Maracumango", 5]);
  });

  it("lee varias hojas y dice cuáles vinieron", async () => {
    const r = await parsearMaestro(
      construirXlsx([
        MARCAS,
        {
          nombre: "cadena",
          filas: [
            ["codigo_externo", "nombre"],
            ["PV", "Plaza Vea"],
          ],
        },
      ]),
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(hojasPresentes(r.hojas)).toEqual(["marca", "cadena"]);
  });

  it("una hoja que falta no es un fallo: el cliente puede no mandar promociones", async () => {
    const r = await parsearMaestro(construirXlsx([MARCAS]));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hojas.promocion).toBeUndefined();
  });

  it("un archivo que no es un Excel da un error legible, no una excepción", async () => {
    // Pasa de verdad: alguien sube un .pdf renombrado.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await parsearMaestro(Buffer.from("esto no es un zip"));

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/no pudimos leer el archivo/i);
  });

  it("el error de la librería se registra, no se le enseña al operador", async () => {
    // Habla de zips y de XML: no le dice nada a quien sube el archivo, y podría
    // arrastrar contenido de él.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await parsearMaestro(Buffer.from("no soy un zip"));

    expect(error).toHaveBeenCalled();
    if (r.ok) return;
    expect(r.error).not.toContain("zip");
  });

  it("un Excel sin ninguna hoja esperada lo dice y enumera las que espera", async () => {
    const r = await parsearMaestro(
      construirXlsx([{ nombre: "Hoja1", filas: [["cualquier cosa"]] }]),
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/marca/);
  });

  it("rechaza un archivo enorme ANTES de descomprimirlo", async () => {
    // Un .xlsx es un zip: la descompresión ocurre antes de poder contar filas, así
    // que el tope de bytes es la única defensa contra uno que se expanda a gigas.
    const r = await parsearMaestro(Buffer.alloc(3 * 1024 * 1024));

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/pesa más de/i);
  });
});
