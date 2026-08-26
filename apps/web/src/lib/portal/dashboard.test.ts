import { describe, expect, it } from "vitest";

import { CLAVES_KPI } from "./reportes";

import {
  armarKpis,
  calcularTendencia,
  colorDePin,
  type FilaKpis,
  periodoAnterior,
  periodoDeFiltros,
  periodoPorDefecto,
} from "./dashboard";

describe("periodoPorDefecto", () => {
  it("son los últimos 30 días hasta hoy (inclusive)", () => {
    const p = periodoPorDefecto(new Date("2026-07-30T12:00:00Z"));
    expect(p).toEqual({ desde: "2026-07-01", hasta: "2026-07-30" });
  });

  it("usa el día de calendario de Lima, no el de UTC, al caer la noche", () => {
    // 2026-07-31T02:00Z = 2026-07-30 21:00 en Lima (UTC-5): sigue siendo 30 de julio.
    const p = periodoPorDefecto(new Date("2026-07-31T02:00:00Z"));
    expect(p).toEqual({ desde: "2026-07-01", hasta: "2026-07-30" });
  });

  it("cruza el fin de mes correctamente", () => {
    const p = periodoPorDefecto(new Date("2026-03-05T12:00:00Z"));
    expect(p).toEqual({ desde: "2026-02-04", hasta: "2026-03-05" });
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

  it("conserva un decimal (los porcentajes vienen redondeados a 1 decimal de la BD)", () => {
    expect(calcularTendencia(87.3, 83.1)).toEqual({
      disponible: true,
      delta: 4.2,
      direccion: "sube",
    });
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

  it("rojo para cualquier otro estado visitado (p. ej. bloqueada)", () => {
    expect(colorDePin("bloqueada", false, true)).toBe("rojo");
  });

  it("la alerta manda aunque no haya visita registrada", () => {
    expect(colorDePin(null, true, false)).toBe("rojo");
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

describe("periodoDeFiltros", () => {
  // 2026-08-05T02:00Z son las 21:00 del 4 de agosto en Lima.
  const ref = new Date("2026-08-05T02:00:00Z");

  it("con los dos extremos, los respeta", () => {
    expect(
      periodoDeFiltros({ desde: "2026-07-01", hasta: "2026-07-31" }, ref),
    ).toEqual({ desde: "2026-07-01", hasta: "2026-07-31" });
  });

  it("con solo DESDE, completa hasta hoy en vez de ignorarlo", () => {
    // Caer al default de 30 días descartaría en silencio lo que el usuario
    // escribió, y no habría forma de saber por qué.
    expect(periodoDeFiltros({ desde: "2026-07-01", hasta: null }, ref)).toEqual(
      {
        desde: "2026-07-01",
        hasta: "2026-08-04",
      },
    );
  });

  it("con solo HASTA, retrocede 30 días desde ahí", () => {
    expect(periodoDeFiltros({ desde: null, hasta: "2026-07-31" }, ref)).toEqual(
      {
        desde: "2026-07-02",
        hasta: "2026-07-31",
      },
    );
  });

  it("sin ninguno, el período por defecto", () => {
    expect(periodoDeFiltros({ desde: null, hasta: null }, ref)).toEqual(
      periodoPorDefecto(ref),
    );
  });
});

describe("el catálogo de KPI del reporte no se desincroniza del dashboard", () => {
  it("armarKpis devuelve exactamente las claves de CLAVES_KPI, en su orden", () => {
    // El configurador del reporte ofrece `CLAVES_KPI`. Si mañana el dashboard
    // gana un séptimo KPI y nadie lo añade ahí, el reporte se quedaría callado
    // con seis en vez de avisar. Este test es quien avisa.
    const claves = armarKpis(FILA).map((k) => k.clave);

    expect(claves).toEqual([...CLAVES_KPI]);
  });
});
