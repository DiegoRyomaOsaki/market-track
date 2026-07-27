import { describe, expect, it } from "@jest/globals";

import { dentroDeGeocerca, distanciaMetros, puntoAEwkt } from "./geo";

// Un punto de referencia en Lima (Plaza Vea San Miguel, aprox).
const TIENDA = { lat: -12.0776, lon: -77.0904, radio_m: 100 };

describe("distanciaMetros", () => {
  it("mismo punto: 0 m", () => {
    expect(distanciaMetros(-12.0776, -77.0904, -12.0776, -77.0904)).toBeCloseTo(
      0,
      5,
    );
  });

  it("un grado de latitud ≈ 111 km", () => {
    const d = distanciaMetros(0, 0, 1, 0);
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });

  it("es simétrica", () => {
    const ida = distanciaMetros(-12.07, -77.09, -12.08, -77.1);
    const vuelta = distanciaMetros(-12.08, -77.1, -12.07, -77.09);
    expect(ida).toBeCloseTo(vuelta, 6);
  });
});

describe("dentroDeGeocerca", () => {
  it("el mismo punto de la tienda está dentro", () => {
    expect(dentroDeGeocerca({ lat: TIENDA.lat, lng: TIENDA.lon }, TIENDA)).toBe(
      true,
    );
  });

  it("a ~50 m está dentro del radio de 100 m", () => {
    // ~0.00045° de latitud ≈ 50 m
    expect(
      dentroDeGeocerca({ lat: TIENDA.lat + 0.00045, lng: TIENDA.lon }, TIENDA),
    ).toBe(true);
  });

  it("a ~300 m está fuera del radio de 100 m", () => {
    expect(
      dentroDeGeocerca({ lat: TIENDA.lat + 0.0027, lng: TIENDA.lon }, TIENDA),
    ).toBe(false);
  });

  it("sin ubicación de tienda no se puede decidir: null", () => {
    expect(
      dentroDeGeocerca(
        { lat: TIENDA.lat, lng: TIENDA.lon },
        { lat: null, lon: null, radio_m: 100 },
      ),
    ).toBeNull();
  });
});

describe("puntoAEwkt", () => {
  it("invierte a POINT(lon lat) con SRID 4326", () => {
    // OJO: PostGIS es (lon lat), no (lat lon).
    expect(puntoAEwkt({ lat: -12.0776, lng: -77.0904 })).toBe(
      "SRID=4326;POINT(-77.0904 -12.0776)",
    );
  });
});
