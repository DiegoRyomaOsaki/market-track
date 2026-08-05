import { describe, expect, it, jest } from "@jest/globals";

// @powersync/react-native arrastra módulos nativos: se moquea el hook que
// revision.ts usa en runtime. Aquí solo se prueba la lógica pura.
jest.mock("@powersync/react-native", () => ({
  useQuery: () => ({ data: [], isLoading: false, error: undefined }),
}));

import {
  DIAS_DE_RECHAZOS_VISIBLES,
  etiquetaDecision,
  rechazosDentroDeVentana,
  type RevisionLocal,
} from "./revision";

// La revisión tal como la ve el mercaderista. Puro: sin PowerSync ni motor nativo.

function revision(over: Partial<RevisionLocal> = {}): RevisionLocal {
  return {
    visita_id: "v1",
    decision: "rechazada",
    motivo: "Falta la foto Después",
    revisado_at: "2026-08-05T12:00:00Z",
    tienda_nombre: "Plaza Vea Surco",
    ...over,
  };
}

describe("etiquetaDecision", () => {
  it("sin decisión, el reporte sigue esperando al supervisor", () => {
    expect(etiquetaDecision(null)).toBe("Pendiente de revisión");
  });

  it("habla en la voz del mercaderista, no en la del panel", () => {
    // Él lee "Rechazado" (su trabajo), no "Rechazada" (la visita).
    expect(etiquetaDecision("aprobada")).toBe("Aprobado");
    expect(etiquetaDecision("rechazada")).toBe("Rechazado");
  });

  it("un valor que no conoce se muestra tal cual en vez de desaparecer", () => {
    // Si una migración añade una decisión, es mejor enseñar algo raro que nada.
    expect(etiquetaDecision("en_disputa")).toBe("en_disputa");
  });
});

describe("rechazosDentroDeVentana", () => {
  const ahora = new Date("2026-08-10T12:00:00Z");

  it("mantiene un rechazo de hace dos días", () => {
    const r = revision({ revisado_at: "2026-08-08T12:00:00Z" });
    expect(rechazosDentroDeVentana([r], ahora)).toHaveLength(1);
  });

  it("descarta uno de hace un mes: ya no hay contexto que corregir", () => {
    const r = revision({ revisado_at: "2026-07-05T12:00:00Z" });
    expect(rechazosDentroDeVentana([r], ahora)).toEqual([]);
  });

  it("las aprobaciones no van al banner: solo se avisa de lo que hay que arreglar", () => {
    const r = revision({ decision: "aprobada", motivo: null });
    expect(rechazosDentroDeVentana([r], ahora)).toEqual([]);
  });

  it("justo en el borde de la ventana todavía se ve", () => {
    const limite = new Date(
      ahora.getTime() - DIAS_DE_RECHAZOS_VISIBLES * 86_400_000,
    ).toISOString();
    expect(
      rechazosDentroDeVentana([revision({ revisado_at: limite })], ahora),
    ).toHaveLength(1);
  });

  it("un segundo antes del borde ya no", () => {
    const fuera = new Date(
      ahora.getTime() - DIAS_DE_RECHAZOS_VISIBLES * 86_400_000 - 1000,
    ).toISOString();
    expect(
      rechazosDentroDeVentana([revision({ revisado_at: fuera })], ahora),
    ).toEqual([]);
  });

  it("sin revisiones no hay banner", () => {
    expect(rechazosDentroDeVentana([], ahora)).toEqual([]);
  });
});
