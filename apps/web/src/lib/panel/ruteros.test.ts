import { describe, expect, it } from "vitest";

import {
  agruparPorDia,
  desplazamientoDeDuplicado,
  finDeMes,
  inicioDeMes,
  inicioDeSemana,
  moverParada,
  periodoVecino,
  rangoDeVista,
  sePuedePublicar,
  type DiaPlaneado,
  type FilaPlaneacion,
  type Parada,
} from "./ruteros";

function fila(over: Partial<FilaPlaneacion> = {}): FilaPlaneacion {
  return {
    rutero_id: "r1",
    fecha: "2026-08-03",
    estado: "borrador",
    parada_id: "p1",
    orden: 1,
    tienda_id: "t1",
    tienda_nombre: "Plaza Vea Surco",
    parada_estado: "pendiente",
    ...over,
  };
}

describe("inicioDeSemana", () => {
  it("la semana empieza en lunes", () => {
    // 2026-08-03 es lunes.
    expect(inicioDeSemana("2026-08-03")).toBe("2026-08-03");
    expect(inicioDeSemana("2026-08-05")).toBe("2026-08-03");
  });

  it("el domingo pertenece a la semana que acaba, no a la que empieza", () => {
    // 2026-08-09 es domingo: su lunes es el 3, no el 10. Tratarlo como primer
    // día —el default de getUTCDay— movería la vista una semana entera.
    expect(inicioDeSemana("2026-08-09")).toBe("2026-08-03");
  });

  it("cruza el cambio de mes hacia atrás", () => {
    // 2026-08-01 es sábado: su lunes cae en julio.
    expect(inicioDeSemana("2026-08-01")).toBe("2026-07-27");
  });
});

describe("límites de mes", () => {
  it("resuelve el último día sin tabla de meses", () => {
    expect(finDeMes("2026-08-15")).toBe("2026-08-31");
    expect(finDeMes("2026-04-01")).toBe("2026-04-30");
  });

  it("acierta en febrero, bisiesto y no bisiesto", () => {
    expect(finDeMes("2026-02-10")).toBe("2026-02-28");
    expect(finDeMes("2028-02-10")).toBe("2028-02-29");
  });

  it("el inicio de mes es el día 1", () => {
    expect(inicioDeMes("2026-08-31")).toBe("2026-08-01");
  });
});

describe("rangoDeVista", () => {
  it("la semana va de lunes a domingo", () => {
    expect(rangoDeVista("semana", "2026-08-05")).toEqual({
      desde: "2026-08-03",
      hasta: "2026-08-09",
    });
  });

  it("el mes va del 1 al último día", () => {
    expect(rangoDeVista("mes", "2026-08-05")).toEqual({
      desde: "2026-08-01",
      hasta: "2026-08-31",
    });
  });
});

describe("periodoVecino", () => {
  it("la semana salta de siete en siete", () => {
    expect(periodoVecino("semana", "2026-08-05", 1)).toBe("2026-08-12");
    expect(periodoVecino("semana", "2026-08-05", -1)).toBe("2026-07-29");
  });

  it("el mes salta a un día 1, no restando días", () => {
    // Desde un 31, restar 30 días caería en el mismo mes o se saltaría uno.
    expect(periodoVecino("mes", "2026-08-31", 1)).toBe("2026-09-01");
    expect(periodoVecino("mes", "2026-03-31", -1)).toBe("2026-02-01");
  });

  it("cruza el cambio de año", () => {
    expect(periodoVecino("mes", "2026-12-15", 1)).toBe("2027-01-01");
    expect(periodoVecino("mes", "2026-01-15", -1)).toBe("2025-12-01");
  });
});

describe("desplazamientoDeDuplicado", () => {
  it("una semana son siete días", () => {
    expect(desplazamientoDeDuplicado("semana", "2026-08-05")).toBe(7);
  });

  it("el mes desplaza sus propios días, no treinta fijos", () => {
    // Copiar agosto (31) con 30 fijos dejaría el último día encima del primero
    // del mes siguiente.
    expect(desplazamientoDeDuplicado("mes", "2026-08-05")).toBe(31);
    expect(desplazamientoDeDuplicado("mes", "2026-02-05")).toBe(28);
    expect(desplazamientoDeDuplicado("mes", "2028-02-05")).toBe(29);
  });
});

describe("agruparPorDia", () => {
  it("rellena los días sin rutero: el hueco es información", () => {
    const dias = agruparPorDia([fila()], "2026-08-03", "2026-08-05");
    expect(dias.map((d) => d.fecha)).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
    ]);
    expect(dias[1]).toMatchObject({ ruteroId: null, paradas: [] });
  });

  it("agrupa varias paradas bajo su día", () => {
    const dias = agruparPorDia(
      [
        fila({ parada_id: "p1", orden: 1 }),
        fila({ parada_id: "p2", orden: 2, tienda_nombre: "Tottus" }),
      ],
      "2026-08-03",
      "2026-08-03",
    );
    expect(dias[0]?.paradas.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("un día con rutero y sin paradas no inventa una parada vacía", () => {
    // La función SQL usa `left join`: ese día llega como una fila con todo lo de
    // la parada en null.
    const dias = agruparPorDia(
      [
        fila({
          parada_id: null,
          orden: null,
          tienda_id: null,
          tienda_nombre: null,
          parada_estado: null,
        }),
      ],
      "2026-08-03",
      "2026-08-03",
    );
    expect(dias[0]).toMatchObject({ ruteroId: "r1", paradas: [] });
  });
});

describe("moverParada", () => {
  const paradas: Parada[] = [
    { id: "a", orden: 1, tiendaId: "t1", tiendaNombre: "A" },
    { id: "b", orden: 2, tiendaId: "t2", tiendaNombre: "B" },
    { id: "c", orden: 3, tiendaId: "t3", tiendaNombre: "C" },
  ];

  it("sube una posición", () => {
    expect(moverParada(paradas, "b", -1)).toEqual(["b", "a", "c"]);
  });

  it("baja una posición", () => {
    expect(moverParada(paradas, "b", 1)).toEqual(["a", "c", "b"]);
  });

  it("en los extremos no mueve nada", () => {
    expect(moverParada(paradas, "a", -1)).toEqual(["a", "b", "c"]);
    expect(moverParada(paradas, "c", 1)).toEqual(["a", "b", "c"]);
  });

  it("una parada que no está en la lista no altera el orden", () => {
    expect(moverParada(paradas, "zzz", 1)).toEqual(["a", "b", "c"]);
  });
});

describe("sePuedePublicar", () => {
  const base: DiaPlaneado = {
    fecha: "2026-08-03",
    ruteroId: "r1",
    estado: "borrador",
    paradas: [{ id: "a", orden: 1, tiendaId: "t1", tiendaNombre: "A" }],
  };

  it("un borrador con paradas sí", () => {
    expect(sePuedePublicar(base)).toBe(true);
  });

  it("un día vacío no: publicarlo no significa nada", () => {
    expect(sePuedePublicar({ ...base, paradas: [] })).toBe(false);
  });

  it("un día sin rutero tampoco", () => {
    expect(sePuedePublicar({ ...base, ruteroId: null })).toBe(false);
  });

  it("lo ya publicado no se vuelve a publicar", () => {
    expect(sePuedePublicar({ ...base, estado: "publicado" })).toBe(false);
    expect(sePuedePublicar({ ...base, estado: "en_curso" })).toBe(false);
  });
});
