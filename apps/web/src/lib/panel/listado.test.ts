import { describe, expect, it } from "vitest";

import {
  escaparPatronIlike,
  leerPagina,
  paginar,
  rangoDe,
  TAMANO_PAGINA,
} from "./listado";

describe("leerPagina", () => {
  it("sin parámetro es la primera página", () => {
    expect(leerPagina(undefined)).toBe(1);
  });

  it("un número válido se respeta", () => {
    expect(leerPagina("3")).toBe(3);
  });

  it("lo que no es un entero positivo cae a la primera", () => {
    expect(leerPagina("abc")).toBe(1);
    expect(leerPagina("-2")).toBe(1);
    expect(leerPagina("0")).toBe(1);
    expect(leerPagina("2.5")).toBe(1);
  });

  it("una página absurda cae a la primera: el OFFSET gigante sería un scan", () => {
    expect(leerPagina("99999999")).toBe(1);
    expect(leerPagina("1e9")).toBe(1);
  });

  it("un parámetro repetido toma el primero", () => {
    expect(leerPagina(["2", "5"])).toBe(2);
  });
});

describe("rangoDe", () => {
  it("la primera página pide una fila de MÁS: la sonda de página siguiente", () => {
    expect(rangoDe(1)).toEqual([0, TAMANO_PAGINA]);
  });

  it("las páginas siguientes avanzan por tamaño de página, no por tamaño de consulta", () => {
    // Si el paso fuera TAMANO_PAGINA + 1, cada página saltaría una fila.
    expect(rangoDe(3)).toEqual([2 * TAMANO_PAGINA, 3 * TAMANO_PAGINA]);
  });
});

describe("paginar", () => {
  const filas = (n: number) => Array.from({ length: n }, (_, i) => i);

  it("una página exactamente llena NO ofrece siguiente", () => {
    // El off-by-one clásico: con él, un listado completo parece recortado y
    // el enlace lleva a una página vacía.
    const p = paginar(filas(TAMANO_PAGINA), 1);
    expect(p.haySiguiente).toBe(false);
    expect(p.filas).toHaveLength(TAMANO_PAGINA);
  });

  it("la fila de sonda anuncia la siguiente y no se muestra", () => {
    const p = paginar(filas(TAMANO_PAGINA + 1), 1);
    expect(p.haySiguiente).toBe(true);
    expect(p.filas).toHaveLength(TAMANO_PAGINA);
  });

  it("la primera página no tiene anterior; la segunda sí", () => {
    expect(paginar(filas(1), 1).hayAnterior).toBe(false);
    expect(paginar(filas(1), 2).hayAnterior).toBe(true);
  });

  it("una página > 1 sin filas se distingue de una tabla vacía", () => {
    expect(paginar([], 2).vaciaFueraDeRango).toBe(true);
    expect(paginar([], 1).vaciaFueraDeRango).toBe(false);
  });
});

describe("escaparPatronIlike", () => {
  it("escapa los comodines del patrón", () => {
    expect(escaparPatronIlike("100%")).toBe("100\\%");
    expect(escaparPatronIlike("a_b")).toBe("a\\_b");
    expect(escaparPatronIlike("a\\b")).toBe("a\\\\b");
  });

  it("neutraliza los separadores de la gramática del .or()", () => {
    // Una coma partiría `codigo.ilike.%X%,nombre.ilike.%Y%` en un filtro extra.
    expect(escaparPatronIlike("1,5L")).toBe("1 5L");
    expect(escaparPatronIlike("(promo)")).toBe("promo");
  });

  it("un término normal pasa intacto", () => {
    expect(escaparPatronIlike("Néctar 1L")).toBe("Néctar 1L");
  });
});
