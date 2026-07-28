import { describe, expect, it, jest } from "@jest/globals";

// @powersync/react-native arrastra módulos nativos: se moquea el hook que
// solicitud-ruta.ts usa en runtime. Aquí solo se prueba la lógica pura.
jest.mock("@powersync/react-native", () => ({
  useQuery: () => ({ data: [], isLoading: false, error: undefined }),
}));

import { etiquetaEstado, solicitudValida } from "./solicitud-ruta";

describe("solicitudValida", () => {
  it("es válida con tipo conocido y motivo con texto", () => {
    expect(solicitudValida("no_visita", "La tienda está cerrada")).toBe(true);
  });

  it("no es válida sin motivo", () => {
    expect(solicitudValida("no_visita", "   ")).toBe(false);
  });

  it("no es válida con un tipo desconocido", () => {
    expect(solicitudValida("cualquier_cosa", "motivo")).toBe(false);
  });
});

describe("etiquetaEstado", () => {
  it("traduce los estados del ciclo", () => {
    expect(etiquetaEstado("nueva")).toBe("Enviada");
    expect(etiquetaEstado("resuelta")).toBe("Resuelta");
  });

  it("devuelve el valor crudo si no lo conoce", () => {
    expect(etiquetaEstado("desconocido")).toBe("desconocido");
  });
});
