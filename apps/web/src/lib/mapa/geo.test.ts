import { describe, expect, it } from "vitest";

import { circuloGeocerca, distanciaMetros, puntoEwkt } from "./geo";

// Plaza Vea La Molina, del seed.
const LIMA = { lat: -12.08, lon: -76.94 };

describe("puntoEwkt", () => {
  it("escribe POINT(lon lat) — en ese orden, no al revés", () => {
    // EL bug clásico de PostGIS: POINT es (X Y) = (lon lat). Invertirlo pone la
    // tienda de Lima en mitad del océano Índico, y la geocerca deja de casar con
    // el GPS del mercaderista sin que nada dé error.
    expect(puntoEwkt(LIMA.lat, LIMA.lon)).toBe(
      "SRID=4326;POINT(-76.94 -12.08)",
    );
  });

  it("rechaza coordenadas fuera del planeta", () => {
    expect(() => puntoEwkt(91, 0)).toThrow();
    expect(() => puntoEwkt(-91, 0)).toThrow();
    expect(() => puntoEwkt(0, 181)).toThrow();
    expect(() => puntoEwkt(0, -181)).toThrow();
  });

  it("rechaza lo que no es un número", () => {
    expect(() => puntoEwkt(Number.NaN, 0)).toThrow();
    expect(() => puntoEwkt(0, Number.POSITIVE_INFINITY)).toThrow();
  });

  it("acepta el (0,0): es una coordenada real, no 'sin dato'", () => {
    expect(puntoEwkt(0, 0)).toBe("SRID=4326;POINT(0 0)");
  });
});

describe("circuloGeocerca", () => {
  it("dibuja un polígono cerrado", () => {
    const c = circuloGeocerca(LIMA.lat, LIMA.lon, 100);
    const anillo = c.coordinates[0]!;
    expect(c.type).toBe("Polygon");
    expect(anillo[0]).toEqual(anillo[anillo.length - 1]);
  });

  it.each([50, 100, 500])(
    "todos sus puntos quedan a %i m del centro (±1 m)",
    (radio) => {
      // Si el círculo no mide lo que dice, el supervisor fija una geocerca
      // mirando un dibujo que miente y el check-in falla en la tienda.
      const c = circuloGeocerca(LIMA.lat, LIMA.lon, radio);
      for (const [lon, lat] of c.coordinates[0]!) {
        const d = distanciaMetros(LIMA.lat, LIMA.lon, lat, lon);
        expect(Math.abs(d - radio)).toBeLessThan(1);
      }
    },
  );

  it("corrige por latitud: un grado de longitud no mide lo mismo en Lima que en el ecuador", () => {
    // Sin el coseno de la latitud, el círculo sale ovalado. En Lima (-12°) el
    // error es del 2%; en Punta Arenas sería del 40%.
    const enLima = circuloGeocerca(-12.08, -76.94, 100);
    const enElEcuador = circuloGeocerca(0, -76.94, 100);
    const anchoLima = Math.abs(enLima.coordinates[0]![0]![0] - -76.94);
    const anchoEcuador = Math.abs(enElEcuador.coordinates[0]![0]![0] - -76.94);
    expect(anchoLima).toBeGreaterThan(anchoEcuador);
  });

  it("rechaza un radio no positivo — la base también (radio_geocerca_m > 0)", () => {
    expect(() => circuloGeocerca(LIMA.lat, LIMA.lon, 0)).toThrow();
    expect(() => circuloGeocerca(LIMA.lat, LIMA.lon, -10)).toThrow();
  });
});
