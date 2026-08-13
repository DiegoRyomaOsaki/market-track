import { describe, expect, it, vi } from "vitest";

// `datos.ts` importa el cliente de servidor, que valida las variables de entorno
// al cargarse. Aquí solo se prueba la lógica pura del módulo, así que se moquea
// para no exigir un `.env` a un test que no toca la base.
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => Promise.resolve(null),
}));

import { escaleraVigente, type NivelBono } from "./datos";

// La escalera VIGENTE es el conjunto de la fecha más reciente: publicar una
// nueva reemplaza la anterior entera. Mezclar dos fechas en la pantalla
// enseñaría peldaños que ya no aplican — y de ellos sale un bono.

function nivel(
  nombre: string,
  puntaje_min: number,
  vigente_desde: string,
): NivelBono {
  return {
    id: `${nombre}-${vigente_desde}`,
    nombre,
    puntaje_min,
    monto: 100,
    vigente_desde,
  };
}

describe("escaleraVigente", () => {
  it("sin niveles devuelve una escalera vacía", () => {
    expect(escaleraVigente([])).toEqual([]);
  });

  it("con una sola escalera la devuelve ordenada por umbral", () => {
    const r = escaleraVigente([
      nivel("Oro", 95, "2026-01-01"),
      nivel("Bronce", 60, "2026-01-01"),
      nivel("Plata", 80, "2026-01-01"),
    ]);
    expect(r.map((n) => n.nombre)).toEqual(["Bronce", "Plata", "Oro"]);
  });

  it("con varias fechas se queda SOLO con la más reciente", () => {
    // El caso que importa: la escalera de enero ya no aplica, y enseñar sus
    // peldaños junto a los de agosto haría creer que conviven.
    const r = escaleraVigente([
      nivel("Bronce", 60, "2026-01-01"),
      nivel("Plata", 80, "2026-01-01"),
      nivel("Único", 50, "2026-08-01"),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]?.nombre).toBe("Único");
  });

  it("compara las fechas como fechas, no por el orden en que llegan", () => {
    // Si se quedara con la primera fila en vez de con la mayor, este caso
    // devolvería la escalera vieja.
    const r = escaleraVigente([
      nivel("Nuevo", 70, "2026-08-01"),
      nivel("Viejo", 60, "2026-01-01"),
    ]);
    expect(r.map((n) => n.nombre)).toEqual(["Nuevo"]);
  });
});
