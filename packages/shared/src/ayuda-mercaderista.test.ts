import { describe, expect, it } from "vitest";

import { AYUDA_MERCADERISTA, type ClaveAyuda } from "./ayuda-mercaderista";

// Las claves con ayuda obligatoria: cada paso del wizard + check-in/out + el
// selector de marcas. Si el wizard gana un paso, aquí falta su ayuda.
const CLAVES: ClaveAyuda[] = [
  "check_in",
  "seleccion_marca",
  "antes",
  "quiebres",
  "precios",
  "exhibiciones",
  "despues",
  "check_out",
  "solicitar_cambio_ruta",
];

describe("AYUDA_MERCADERISTA", () => {
  it("tiene ayuda para cada clave esperada", () => {
    for (const clave of CLAVES) {
      expect(AYUDA_MERCADERISTA[clave]).toBeDefined();
    }
  });

  it("cada ayuda tiene título y al menos un párrafo no vacío", () => {
    for (const clave of CLAVES) {
      const ayuda = AYUDA_MERCADERISTA[clave];
      expect(ayuda.titulo.trim().length).toBeGreaterThan(0);
      expect(ayuda.cuerpo.length).toBeGreaterThan(0);
      for (const parrafo of ayuda.cuerpo) {
        expect(parrafo.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
