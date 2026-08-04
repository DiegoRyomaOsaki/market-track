import { describe, expect, it } from "vitest";

import {
  aplicarResolucion,
  estaPendiente,
  etiquetaEstado,
  etiquetaTipo,
  pendientes,
  type Solicitud,
} from "./solicitudes";

function solicitud(over: Partial<Solicitud> = {}): Solicitud {
  return {
    id: "s1",
    mercaderista_id: "m1",
    mercaderista_nombre: "Ana",
    tipo: "cambio_dia",
    motivo: "Tienda cerrada por inventario",
    estado: "nueva",
    fecha: null,
    rutero_fecha: null,
    comentario_resolucion: null,
    resuelta_por_nombre: null,
    resuelta_at: null,
    creada_at: "2026-08-04T14:00:00Z",
    ...over,
  };
}

describe("etiquetas", () => {
  it("cada tipo tiene su nombre en el vocabulario del cliente", () => {
    expect(etiquetaTipo("cambio_tienda")).toBe("Cambio de tienda");
    expect(etiquetaTipo("no_visita")).toBe("No podrá visitar");
  });

  it("`resuelta` se presenta como Aprobada: es lo que hizo el supervisor", () => {
    expect(etiquetaEstado("resuelta")).toBe("Aprobada");
    expect(etiquetaEstado("rechazada")).toBe("Rechazada");
  });
});

describe("estaPendiente", () => {
  it("nueva y vista siguen esperando decisión", () => {
    expect(estaPendiente("nueva")).toBe(true);
    expect(estaPendiente("vista")).toBe(true);
  });

  it("aprobada y rechazada ya no", () => {
    expect(estaPendiente("resuelta")).toBe(false);
    expect(estaPendiente("rechazada")).toBe(false);
  });
});

describe("pendientes", () => {
  it("cuenta solo las que esperan al supervisor", () => {
    expect(
      pendientes([
        solicitud({ id: "a", estado: "nueva" }),
        solicitud({ id: "b", estado: "vista" }),
        solicitud({ id: "c", estado: "resuelta" }),
        solicitud({ id: "d", estado: "rechazada" }),
      ]),
    ).toBe(2);
  });

  it("una bandeja vacía no tiene pendientes", () => {
    expect(pendientes([])).toBe(0);
  });
});

describe("aplicarResolucion", () => {
  it("aprobar deja el comentario y quién resolvió", () => {
    const [resultado] = aplicarResolucion([solicitud({ id: "s1" })], {
      id: "s1",
      estado: "resuelta",
      comentario: "Aprobado, ajusto el rutero",
      resueltaPorNombre: "Carla",
      resueltaAt: "2026-08-04T15:00:00Z",
    });
    expect(resultado?.estado).toBe("resuelta");
    expect(resultado?.comentario_resolucion).toBe("Aprobado, ajusto el rutero");
    expect(resultado?.resuelta_por_nombre).toBe("Carla");
  });

  it("baja el contador de pendientes", () => {
    const actuales = [
      solicitud({ id: "a", estado: "nueva" }),
      solicitud({ id: "b", estado: "nueva" }),
    ];
    expect(pendientes(actuales)).toBe(2);
    const resultado = aplicarResolucion(actuales, {
      id: "a",
      estado: "rechazada",
      comentario: "No procede",
      resueltaPorNombre: "Carla",
      resueltaAt: "2026-08-04T15:00:00Z",
    });
    expect(pendientes(resultado)).toBe(1);
  });

  it("no toca las demás filas ni los campos que no cambian", () => {
    const resultado = aplicarResolucion(
      [
        solicitud({ id: "a", motivo: "Motivo A" }),
        solicitud({ id: "b", motivo: "Motivo B" }),
      ],
      {
        id: "a",
        estado: "resuelta",
        comentario: "Ok",
        resueltaPorNombre: "Carla",
        resueltaAt: "2026-08-04T15:00:00Z",
      },
    );
    expect(resultado[0]?.motivo).toBe("Motivo A");
    expect(resultado[1]).toMatchObject({ estado: "nueva", motivo: "Motivo B" });
  });
});
