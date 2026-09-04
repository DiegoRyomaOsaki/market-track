import { describe, expect, it, jest } from "@jest/globals";

// @powersync/react-native arrastra módulos nativos: se moquea al hook que rutero.ts
// usa en runtime. Aquí solo se prueba estadoVisual (lógica pura).
jest.mock("@powersync/react-native", () => ({
  useQuery: () => ({ data: [], isLoading: false, error: undefined }),
}));

import { estadoVisual, horaEsperada } from "./rutero";

describe("estadoVisual", () => {
  it("sin visita: pendiente", () => {
    expect(estadoVisual(null)).toBe("pendiente");
  });

  it("visita en curso: en_curso", () => {
    expect(estadoVisual("en_curso")).toBe("en_curso");
  });

  it("visita bloqueada (contingencia) sigue contando como en curso", () => {
    expect(estadoVisual("bloqueada")).toBe("en_curso");
  });

  it("visita completada: completada", () => {
    expect(estadoVisual("completada")).toBe("completada");
  });
});

describe("horaEsperada", () => {
  it("recorta los segundos del `time` que baja la réplica", () => {
    expect(horaEsperada("08:30:00")).toBe("08:30");
  });

  it("sin hora fijada no inventa ninguna", () => {
    // La mayoría de las paradas no llevarán hora al principio, y un "00:00" ahí
    // le diría al mercaderista que llegó tarde a todo.
    expect(horaEsperada(null)).toBe(null);
  });
});
