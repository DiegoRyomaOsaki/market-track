import { describe, expect, it } from "vitest";

import {
  aplicarDecision,
  estiloDecision,
  etiquetaDecision,
  faltaEvidencia,
  pendientes,
  type VisitaEnCola,
} from "./revision";

function visita(over: Partial<VisitaEnCola> = {}): VisitaEnCola {
  return {
    visita_id: "v1",
    mercaderista_id: "m1",
    mercaderista_nombre: "José Quispe",
    tienda_nombre: "Plaza Vea Surco",
    cadena_nombre: "Plaza Vea",
    check_in_at: "2026-08-03T14:00:00Z",
    check_out_at: "2026-08-03T14:47:00Z",
    duracion_min: 47,
    check_in_geocerca_ok: true,
    check_out_geocerca_ok: true,
    marcas: 2,
    omitidos: 0,
    contingencias: 0,
    quiebres: 1,
    fotos: 4,
    fotos_pendientes: 0,
    decision: null,
    motivo: null,
    revisor_nombre: null,
    revisado_at: null,
    ...over,
  };
}

describe("etiquetaDecision", () => {
  it("sin decisión, el reporte está pendiente", () => {
    // La ausencia de fila ES el estado: no hay un tercer valor del enum.
    expect(etiquetaDecision(null)).toBe("Pendiente");
  });

  it("etiqueta cada decisión del enum", () => {
    expect(etiquetaDecision("aprobada")).toBe("Aprobada");
    expect(etiquetaDecision("rechazada")).toBe("Rechazada");
  });

  it("cada estado tiene su propio tono, incluido el pendiente", () => {
    // Tres estados con el mismo color serían un semáforo que no dice nada.
    const tonos = new Set([
      estiloDecision(null),
      estiloDecision("aprobada"),
      estiloDecision("rechazada"),
    ]);
    expect(tonos.size).toBe(3);
  });
});

describe("pendientes", () => {
  it("cuenta las que no tienen decisión", () => {
    expect(
      pendientes([
        visita(),
        visita({ visita_id: "v2", decision: "aprobada" }),
        visita({ visita_id: "v3" }),
      ]),
    ).toBe(2);
  });

  it("una cola vacía no tiene pendientes", () => {
    expect(pendientes([])).toBe(0);
  });

  it("una rechazada ya está decidida: no cuenta como pendiente", () => {
    expect(pendientes([visita({ decision: "rechazada" })])).toBe(0);
  });
});

describe("faltaEvidencia", () => {
  it("hay evidencia pendiente si alguna foto sigue sin subir", () => {
    expect(faltaEvidencia(visita({ fotos_pendientes: 2 }))).toBe(true);
  });

  it("con todo subido no falta nada", () => {
    expect(faltaEvidencia(visita({ fotos_pendientes: 0 }))).toBe(false);
  });

  it("una visita sin ninguna foto no cuenta como evidencia pendiente", () => {
    // No es lo mismo "no tomó fotos" que "las tomó y siguen en el teléfono".
    expect(faltaEvidencia(visita({ fotos: 0, fotos_pendientes: 0 }))).toBe(
      false,
    );
  });
});

describe("aplicarDecision", () => {
  const decidida = {
    visitaId: "v2",
    decision: "rechazada" as const,
    motivo: "Falta la foto Después",
    revisorNombre: "Ana Torres",
    revisadoAt: "2026-08-05T10:00:00Z",
  };

  it("actualiza solo la visita decidida", () => {
    const antes = [visita(), visita({ visita_id: "v2" })];
    const despues = aplicarDecision(antes, decidida);

    expect(despues[0]?.decision).toBeNull();
    expect(despues[1]).toMatchObject({
      decision: "rechazada",
      motivo: "Falta la foto Después",
      revisor_nombre: "Ana Torres",
      revisado_at: "2026-08-05T10:00:00Z",
    });
  });

  it("no toca el resto de campos de la fila", () => {
    const antes = [visita({ visita_id: "v2", quiebres: 7 })];
    expect(aplicarDecision(antes, decidida)[0]?.quiebres).toBe(7);
  });

  it("si la visita ya no está en la lista, no inventa una fila", () => {
    const antes = [visita()];
    expect(aplicarDecision(antes, decidida)).toHaveLength(1);
    expect(aplicarDecision(antes, decidida)[0]?.decision).toBeNull();
  });

  it("no muta la lista original", () => {
    const antes = [visita({ visita_id: "v2" })];
    aplicarDecision(antes, decidida);
    expect(antes[0]?.decision).toBeNull();
  });
});
