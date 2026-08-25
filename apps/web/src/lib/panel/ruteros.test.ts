import { describe, expect, it } from "vitest";

import {
  agruparPorDia,
  desplazamientoDeDuplicado,
  finDeMes,
  horaCorta,
  inicioDeMes,
  inicioDeSemana,
  moverParada,
  periodoVecino,
  rangoDeVista,
  sePuedeEditarHora,
  sePuedePublicar,
  sePuedeQuitarParada,
  sePuedeReordenar,
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
    hora_planificada: null,
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

describe("horaCorta", () => {
  it("recorta los segundos que devuelve Postgres", () => {
    // `input[type=time]` sin `step` rechaza `HH:MM:SS` y se queda VACÍO en
    // silencio: el supervisor vería la hora en blanco creyendo que no se guardó.
    expect(horaCorta("08:30:00")).toBe("08:30");
  });

  it("sin hora fijada devuelve null, no una cadena vacía", () => {
    expect(horaCorta(null)).toBe(null);
  });
});

describe("agruparPorDia con horas", () => {
  it("lleva la hora de cada parada, ya recortada", () => {
    const [dia] = agruparPorDia(
      [fila({ hora_planificada: "07:45:00" })],
      "2026-08-03",
      "2026-08-03",
    );
    expect(dia?.paradas[0]?.hora).toBe("07:45");
  });

  it("una parada sin hora la deja nula: no se fijó ninguna", () => {
    const [dia] = agruparPorDia([fila()], "2026-08-03", "2026-08-03");
    expect(dia?.paradas[0]?.hora).toBe(null);
  });
});

describe("moverParada", () => {
  const paradas: Parada[] = [
    {
      id: "a",
      orden: 1,
      tiendaId: "t1",
      tiendaNombre: "A",
      hora: null,
      tieneVisita: false,
    },
    {
      id: "b",
      orden: 2,
      tiendaId: "t2",
      tiendaNombre: "B",
      hora: null,
      tieneVisita: false,
    },
    {
      id: "c",
      orden: 3,
      tiendaId: "t3",
      tiendaNombre: "C",
      hora: null,
      tieneVisita: false,
    },
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
    paradas: [
      {
        id: "a",
        orden: 1,
        tiendaId: "t1",
        tiendaNombre: "A",
        hora: null,
        tieneVisita: false,
      },
    ],
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

// ---------------------------------------------------------------------------
// Qué se puede hacer con una parada, y POR QUÉ no cuando no se puede
//
// El motivo se prueba junto al booleano a propósito: el valor de este cambio no
// es el permiso —el servidor ya lo aplicaba— sino la explicación. Un test que
// solo mirase `puede` pasaría en verde con todos los motivos en blanco.
// ---------------------------------------------------------------------------
describe("permisos por parada", () => {
  const ESTADOS = ["borrador", "publicado", "en_curso", "completado"] as const;
  const HOY = "2026-08-03";

  function diaCon(
    estado: (typeof ESTADOS)[number] | null,
    fecha = HOY,
  ): DiaPlaneado {
    return { fecha, ruteroId: "r1", estado, paradas: [] };
  }

  function paradaCon(tieneVisita: boolean): Parada {
    return {
      id: "a",
      orden: 1,
      tiendaId: "t1",
      tiendaNombre: "Plaza Vea Surco",
      hora: null,
      tieneVisita,
    };
  }

  it.each([
    ["borrador", true, ""],
    ["publicado", true, ""],
    ["en_curso", false, "El día ya empezó"],
    ["completado", false, "El día ya cerró"],
  ] as const)("quitar en %s", (estado, puede, motivo) => {
    const r = sePuedeQuitarParada(diaCon(estado), paradaCon(false), HOY);
    expect(r.puede).toBe(puede);
    if (!r.puede) expect(r.motivo).toBe(motivo);
  });

  it.each(ESTADOS)("con visita no se quita, ni en %s", (estado) => {
    const r = sePuedeQuitarParada(diaCon(estado), paradaCon(true), HOY);
    expect(r).toEqual({
      puede: false,
      motivo: "Ya tiene una visita registrada",
    });
  });

  it("la VISITA gana la precedencia sobre el estado", () => {
    // Es la razón más concreta y la que el servidor aplicaría igualmente: decir
    // "el día ya empezó" mandaría a corregir lo que no es.
    const r = sePuedeQuitarParada(diaCon("en_curso"), paradaCon(true), HOY);
    expect(r).toEqual({
      puede: false,
      motivo: "Ya tiene una visita registrada",
    });
  });

  it("un día pasado no se toca aunque el rutero siga publicado", () => {
    // `rutero.estado` no sale nunca de `publicado`: sin esto, el rutero de hace
    // tres meses seguiría siendo editable y quitarle una parada borraría un
    // `falto` del periodo abierto.
    const r = sePuedeQuitarParada(
      diaCon("publicado", "2026-08-01"),
      paradaCon(false),
      HOY,
    );
    expect(r).toEqual({ puede: false, motivo: "Ese día ya pasó" });
  });

  it("el día de mañana sí", () => {
    expect(
      sePuedeQuitarParada(
        diaCon("publicado", "2026-08-04"),
        paradaCon(false),
        HOY,
      ).puede,
    ).toBe(true);
  });

  it("un día sin rutero no tiene parada que quitar", () => {
    expect(sePuedeQuitarParada(diaCon(null), paradaCon(false), HOY)).toEqual({
      puede: false,
      motivo: "No hay rutero",
    });
  });

  it.each([
    ["borrador", true],
    ["publicado", true],
    ["en_curso", false],
    ["completado", false],
  ] as const)("reordenar en %s", (estado, puede) => {
    expect(sePuedeReordenar(diaCon(estado)).puede).toBe(puede);
  });

  it.each(["publicado", "en_curso", "completado"] as const)(
    "la hora NO se edita en %s, y se dice por qué",
    (estado) => {
      // La base lo rechaza a propósito: la hora es la vara que mide la
      // puntualidad y de ahí sale el bono.
      const r = sePuedeEditarHora(diaCon(estado));
      expect(r).toEqual({
        puede: false,
        motivo: "La hora fija la puntualidad y el día ya se publicó",
      });
    },
  );

  it("la hora sí se edita en borrador", () => {
    expect(sePuedeEditarHora(diaCon("borrador")).puede).toBe(true);
  });
});
