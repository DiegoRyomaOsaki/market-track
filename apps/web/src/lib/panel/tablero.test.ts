import { describe, expect, it } from "vitest";

import {
  aplicarCambioDeVisita,
  colorDeVisita,
  formatoDuracion,
  hoyEnLima,
  marcarAtendida,
  sinAtender,
  textoDeVisita,
  type Contingencia,
  type FilaTablero,
} from "./tablero";

function fila(over: Partial<FilaTablero> = {}): FilaTablero {
  return {
    visita_id: "v1",
    mercaderista_nombre: "Ana",
    mercaderista_dni: "12345678",
    tienda_id: "t1",
    tienda_nombre: "Plaza Vea Surco",
    tienda_lat: -12.1,
    tienda_lon: -76.9,
    check_in_at: "2026-08-03T14:00:00Z",
    check_out_at: null,
    duracion_min: 30,
    tiempo_traslado_min: 15,
    bateria_inicio_pct: 80,
    fotos: 3,
    estado: "en_curso",
    motivo: null,
    ...over,
  };
}

function contingencia(over: Partial<Contingencia> = {}): Contingencia {
  return {
    id: "c1",
    visita_id: "v1",
    tienda_nombre: "Plaza Vea Surco",
    mercaderista_nombre: "Ana",
    paso: "precios",
    motivo: "Góndola en remodelación",
    estado: "nueva",
    creado_at: "2026-08-03T14:30:00Z",
    ...over,
  };
}

describe("hoyEnLima", () => {
  it("a las 20:00 de Lima el día sigue siendo el de Lima, no el de UTC", () => {
    // 2026-08-04T01:00Z son las 20:00 del 3 de agosto en Lima. Usar la fecha UTC
    // adelantaría el tablero un día justo en el turno de cierre de tienda.
    expect(hoyEnLima(new Date("2026-08-04T01:00:00Z"))).toBe("2026-08-03");
  });

  it("a media mañana coinciden", () => {
    expect(hoyEnLima(new Date("2026-08-03T15:00:00Z"))).toBe("2026-08-03");
  });
});

describe("formatoDuracion", () => {
  it("bajo la hora muestra solo minutos", () => {
    expect(formatoDuracion(45)).toBe("45 min");
  });

  it("sobre la hora separa horas y minutos", () => {
    expect(formatoDuracion(85)).toBe("1 h 25 min");
  });

  it("sin duración no inventa un cero", () => {
    expect(formatoDuracion(null)).toBe("—");
  });
});

describe("estado de la visita", () => {
  it("la bloqueada sale en rojo: es la que exige decisión", () => {
    expect(colorDeVisita("bloqueada")).toBe("rojo");
    expect(colorDeVisita("en_curso")).toBe("ambar");
    expect(colorDeVisita("completada")).toBe("verde");
  });

  it("cada estado tiene texto, no solo color", () => {
    expect(textoDeVisita("bloqueada")).toBe("visita bloqueada");
  });
});

describe("sinAtender", () => {
  it("cuenta las que no están resueltas", () => {
    expect(
      sinAtender([
        contingencia({ id: "a", estado: "nueva" }),
        contingencia({ id: "b", estado: "vista" }),
        contingencia({ id: "c", estado: "resuelta" }),
      ]),
    ).toBe(2);
  });

  it("sin contingencias el badge es cero", () => {
    expect(sinAtender([])).toBe(0);
  });
});

describe("aplicarCambioDeVisita", () => {
  it("el check-out actualiza el estado de la fila en pantalla", () => {
    const filas = [fila({ visita_id: "v1" }), fila({ visita_id: "v2" })];
    const resultado = aplicarCambioDeVisita(filas, {
      id: "v1",
      estado: "completada",
      check_out_at: "2026-08-03T15:00:00Z",
    });
    expect(resultado[0]?.estado).toBe("completada");
    expect(resultado[0]?.check_out_at).toBe("2026-08-03T15:00:00Z");
    expect(resultado[1]?.estado).toBe("en_curso");
  });

  it("conserva los campos que el evento no trae", () => {
    // El broadcast lleva la fila cruda de `visita`: sin nombre, sin fotos, sin
    // motivo. Si el evento los machacara, la tabla se quedaría en blanco en vivo.
    const [resultado] = aplicarCambioDeVisita(
      [
        fila({
          mercaderista_nombre: "Ana",
          fotos: 3,
          motivo: "Pasillo cerrado",
        }),
      ],
      { id: "v1", estado: "completada", check_out_at: null },
    );
    expect(resultado?.mercaderista_nombre).toBe("Ana");
    expect(resultado?.fotos).toBe(3);
    expect(resultado?.motivo).toBe("Pasillo cerrado");
  });

  it("una visita que no está en la tabla se ignora", () => {
    // Llegará completa en la próxima carga del servidor. Inventarla aquí la
    // pintaría sin mercaderista ni tienda.
    const filas = [fila({ visita_id: "v1" })];
    const resultado = aplicarCambioDeVisita(filas, {
      id: "desconocida",
      estado: "en_curso",
      check_out_at: null,
    });
    expect(resultado).toHaveLength(1);
    expect(resultado[0]?.visita_id).toBe("v1");
  });
});

describe("marcarAtendida", () => {
  it("resuelve solo la pulsada y baja el badge", () => {
    const actuales = [
      contingencia({ id: "a", estado: "nueva" }),
      contingencia({ id: "b", estado: "nueva" }),
    ];
    expect(sinAtender(actuales)).toBe(2);
    const resultado = marcarAtendida(actuales, "a");
    expect(sinAtender(resultado)).toBe(1);
    expect(resultado.find((c) => c.id === "b")?.estado).toBe("nueva");
  });
});
