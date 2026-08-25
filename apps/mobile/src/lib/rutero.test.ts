import { describe, expect, it, jest } from "@jest/globals";

// @powersync/react-native arrastra módulos nativos: se moquea al hook que rutero.ts
// usa en runtime. Aquí solo se prueba estadoVisual (lógica pura).
jest.mock("@powersync/react-native", () => ({
  useQuery: () => ({ data: [], isLoading: false, error: undefined }),
}));

import {
  estadoVisual,
  horaEsperada,
  promedioPerfectStore,
  ultimaVisitaAjena,
  type UltimaVisita,
} from "./rutero";

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

describe("ultimaVisitaAjena", () => {
  const VISITAS: UltimaVisita[] = [
    {
      tienda_id: "t1",
      rutero_parada_id: "parada-de-hoy",
      check_out_at: "2026-08-24T18:00:00.000Z",
      perfect_store_pct: 92,
    },
    {
      tienda_id: "t2",
      rutero_parada_id: "parada-vieja",
      check_out_at: "2026-08-12T18:00:00.000Z",
      perfect_store_pct: 78,
    },
  ];

  it("devuelve la última visita de esa tienda", () => {
    expect(ultimaVisitaAjena(VISITAS, "t2", "parada-de-hoy")).toMatchObject({
      perfect_store_pct: 78,
    });
  });

  it("DESCARTA la visita de hoy: «la última vez» es la anterior", () => {
    // Si el mercaderista ya hizo el check-out de hoy, enseñarle el puntaje que
    // acaba de sacar como referencia de lo que va a mejorar no dice nada.
    expect(ultimaVisitaAjena(VISITAS, "t1", "parada-de-hoy")).toBeNull();
  });

  it("una tienda nunca visitada devuelve null, no un cero", () => {
    expect(ultimaVisitaAjena(VISITAS, "t99", "parada-de-hoy")).toBeNull();
  });
});

describe("promedioPerfectStore", () => {
  // El gemelo puro del `ROUND(AVG(total_pct), 2)` de la consulta: la consulta la
  // resuelve SQLite, esto la resuelve en TypeScript, y las dos dicen lo mismo.
  it("promedia los levantamientos de la visita (uno por marca)", () => {
    expect(promedioPerfectStore([90, 80])).toBe(85);
  });

  it("IGNORA los nulos, igual que AVG: un levantamiento sin puntuar no hunde la visita", () => {
    expect(promedioPerfectStore([90, null, 80])).toBe(85);
  });

  it("si NINGUNO puntuó devuelve null, nunca 0", () => {
    // Un cero diría "la tienda quedó fatal"; la verdad es "no se evaluó".
    expect(promedioPerfectStore([null, null])).toBeNull();
    expect(promedioPerfectStore([])).toBeNull();
  });

  it("redondea a dos decimales", () => {
    expect(promedioPerfectStore([90, 80, 75])).toBe(81.67);
  });
});
