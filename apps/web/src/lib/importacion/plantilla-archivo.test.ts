import { describe, expect, it } from "vitest";

import { parsearMaestro } from "./parseo";
import { COLUMNAS, HOJAS } from "./plantilla";
import { construirPlantilla } from "./plantilla-archivo";
import { type ClavesExistentes, validarMaestro } from "./validacion";

// El test que ata la plantilla al importador.
//
// El riesgo real de este archivo no es que se genere mal: es que se genere bien
// y el importador espere otra cosa. Por eso la plantilla no se compara contra un
// literal escrito a mano —eso solo probaría que dos copias coinciden hoy— sino
// que se pasa por el parseo y la validación de verdad.

const SIN_NADA: ClavesExistentes = {
  marca: new Set(),
  cadena: new Set(),
  sku: new Set(),
  tienda: new Set(),
};

describe("la plantilla del maestro comercial", () => {
  it("el importador la lee entera: una hoja por entidad", async () => {
    const parseo = await parsearMaestro(construirPlantilla());

    expect(parseo.ok).toBe(true);
    if (!parseo.ok) return;
    expect(Object.keys(parseo.hojas).sort()).toEqual([...HOJAS].sort());
  });

  it("sus cabeceras son las columnas que la validación espera", async () => {
    const parseo = await parsearMaestro(construirPlantilla());
    if (!parseo.ok) throw new Error(parseo.error);

    for (const hoja of HOJAS) {
      expect(parseo.hojas[hoja]?.[0]).toEqual([...COLUMNAS[hoja]]);
    }
  });

  it("vacía no da NINGÚN error: el cliente empieza de cero, no corrigiendo", async () => {
    const parseo = await parsearMaestro(construirPlantilla());
    if (!parseo.ok) throw new Error(parseo.error);

    const { lote, errores } = validarMaestro(parseo.hojas, SIN_NADA);

    expect(errores).toEqual([]);
    // Sin filas de ejemplo: una fila de muestra entraría al maestro como dato.
    for (const hoja of HOJAS) expect(lote[hoja]).toEqual([]);
  });
});
