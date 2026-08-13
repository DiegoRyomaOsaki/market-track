import { PERIODOS_PUNTAJE, TIPOS_TIENDA } from "@market-track/shared";
import { describe, expect, it } from "vitest";

import {
  ETIQUETA_MERCHANDISER,
  ETIQUETA_PERFECT_STORE,
  ETIQUETA_PERIODO,
  ETIQUETA_TIPO_TIENDA,
  EXPLICACION_MERCHANDISER,
  EXPLICACION_PERFECT_STORE,
  VARIABLES_MERCHANDISER,
  VARIABLES_PERFECT_STORE,
} from "./textos";

// Los mapas son `Record` exhaustivos sobre su unión, así que el compilador ya
// exige todas las claves. Lo que estos tests añaden es que ninguna esté VACÍA:
// un `Record` completo con una cadena en blanco compila igual y deja un campo
// sin explicación en pantalla.

describe("explicaciones de las variables", () => {
  it("cada variable de Perfect Store tiene etiqueta y explicación con contenido", () => {
    for (const v of VARIABLES_PERFECT_STORE) {
      expect(ETIQUETA_PERFECT_STORE[v].trim().length).toBeGreaterThan(0);
      expect(EXPLICACION_PERFECT_STORE[v].trim().length).toBeGreaterThan(20);
    }
  });

  it("cada variable del plan de lealtad también", () => {
    for (const v of VARIABLES_MERCHANDISER) {
      expect(ETIQUETA_MERCHANDISER[v].trim().length).toBeGreaterThan(0);
      expect(EXPLICACION_MERCHANDISER[v].trim().length).toBeGreaterThan(20);
    }
  });

  it("la explicación del tiempo efectivo dice que no se puntúa", () => {
    // Es la única variable apagada: si el texto no lo dijera, el admin creería
    // que su peso hace algo.
    expect(EXPLICACION_MERCHANDISER.tiempo_efectivo).toMatch(/no se puntúa/i);
  });

  it("las dos variables de Perfect Store que aún no se capturan lo advierten", () => {
    expect(EXPLICACION_PERFECT_STORE.pop).toMatch(/todavía no se captura/i);
    expect(EXPLICACION_PERFECT_STORE.orden).toMatch(/todavía no se captura/i);
  });
});

describe("etiquetas de los enums", () => {
  it("cubre todos los periodos que la base admite", () => {
    for (const p of PERIODOS_PUNTAJE) {
      expect(ETIQUETA_PERIODO[p].trim().length).toBeGreaterThan(0);
    }
  });

  it("cubre todos los tipos de tienda que la base admite", () => {
    // Derivado del enum de la base, no de una lista a mano: si una migración
    // añade un tipo, este test se pone rojo antes de que la pantalla lo pinte
    // en blanco.
    for (const t of TIPOS_TIENDA) {
      expect(ETIQUETA_TIPO_TIENDA[t].trim().length).toBeGreaterThan(0);
    }
  });
});
