import { describe, expect, it } from "vitest";

import {
  armarKpis,
  calcularTendencia,
  colorDePin,
  type FilaKpis,
  periodoAnterior,
  periodoPorDefecto,
} from "./dashboard";

describe("periodoPorDefecto", () => {
  it("son los últimos 30 días hasta hoy (inclusive)", () => {
    const p = periodoPorDefecto(new Date("2026-07-30T12:00:00Z"));
    expect(p).toEqual({ desde: "2026-07-01", hasta: "2026-07-30" });
  });
});

describe("periodoAnterior", () => {
  it("es la misma duración, contigua y justo antes de `desde`", () => {
    const p = periodoAnterior({ desde: "2026-07-01", hasta: "2026-07-30" });
    expect(p).toEqual({ desde: "2026-06-01", hasta: "2026-06-30" });
  });

  it("un período de un día tiene un previo de un día", () => {
    const p = periodoAnterior({ desde: "2026-07-10", hasta: "2026-07-10" });
    expect(p).toEqual({ desde: "2026-07-09", hasta: "2026-07-09" });
  });
});

describe("calcularTendencia", () => {
  it("sube cuando el actual es mayor", () => {
    expect(calcularTendencia(87, 83)).toEqual({
      disponible: true,
      delta: 4,
      direccion: "sube",
    });
  });

  it("baja cuando el actual es menor", () => {
    expect(calcularTendencia(9, 12)).toMatchObject({
      direccion: "baja",
      delta: -3,
    });
  });

  it("igual cuando no cambia", () => {
    expect(calcularTendencia(5, 5)).toMatchObject({
      direccion: "igual",
      delta: 0,
    });
  });

  it("no disponible si falta el actual o el previo", () => {
    expect(calcularTendencia(5, null)).toEqual({ disponible: false });
    expect(calcularTendencia(null, 5)).toEqual({ disponible: false });
  });
});

describe("colorDePin", () => {
  it("rojo si hay alerta, aunque la visita esté completada", () => {
    expect(colorDePin("completada", true, true)).toBe("rojo");
  });

  it("rojo si no fue visitada en el período", () => {
    expect(colorDePin(null, false, false)).toBe("rojo");
  });

  it("ámbar si la visita está en curso", () => {
    expect(colorDePin("en_curso", false, true)).toBe("ambar");
  });

  it("verde si la visita se completó sin alerta", () => {
    expect(colorDePin("completada", false, true)).toBe("verde");
  });
});

const FILA: FilaKpis = {
  cumplimiento_pct: 87,
  cumplimiento_pct_prev: 83,
  quiebres: 12,
  quiebres_prev: 15,
  diferencias: 4,
  diferencias_prev: 4,
  sos_pct: 45,
  sos_pct_prev: null,
  exhib_cumplidas: 3,
  exhib_negociadas: 5,
  exhib_cumplidas_prev: 2,
  exhib_negociadas_prev: 4,
  desviaciones_precio: 2,
  desviaciones_precio_prev: 1,
};

describe("armarKpis", () => {
  it("arma las 6 tarjetas con su formato", () => {
    const kpis = armarKpis(FILA);
    expect(kpis.map((k) => k.clave)).toEqual([
      "cumplimiento",
      "quiebres",
      "diferencias",
      "sos",
      "exhibiciones",
      "precio",
    ]);
    expect(kpis[0]?.valor).toBe("87%");
    expect(kpis[4]?.valor).toBe("3 / 5");
  });

  it("marca subir-es-bueno solo en cumplimiento, SOS y exhibiciones", () => {
    const buenos = armarKpis(FILA)
      .filter((k) => k.subirEsBueno)
      .map((k) => k.clave);
    expect(buenos).toEqual(["cumplimiento", "sos", "exhibiciones"]);
  });

  it("un valor nulo se muestra como raya y sin tendencia", () => {
    const kpis = armarKpis({ ...FILA, sos_pct: null });
    const sos = kpis.find((k) => k.clave === "sos");
    expect(sos?.valor).toBe("—");
    expect(sos?.tendencia).toEqual({ disponible: false });
  });

  it("exhibiciones sin negociadas se muestra como raya", () => {
    const kpis = armarKpis({ ...FILA, exhib_negociadas: 0 });
    expect(kpis.find((k) => k.clave === "exhibiciones")?.valor).toBe("—");
  });
});
