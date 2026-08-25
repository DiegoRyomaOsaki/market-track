import { describe, expect, it, jest } from "@jest/globals";

// @powersync/react-native arrastra módulos nativos: se moquea al hook que
// desempeno.ts usa en runtime. Aquí solo se prueba la lógica pura.
jest.mock("@powersync/react-native", () => ({
  useQuery: () => ({ data: [], isLoading: false, error: undefined }),
}));

import {
  desglosePorVariable,
  fechaCorta,
  formatearPct,
  periodoVigente,
  resolverPeriodicidad,
  serieDeEvolucion,
  textoDeMiPosicion,
  textoFrescura,
  type FilaPuntaje,
} from "./desempeno";

// La lógica de "Mi desempeño", probada sin el motor nativo: todo lo de aquí es
// puro a propósito, porque `apps/mobile` no tiene tests de componente y lo que
// entre en un `.tsx` queda sin cubrir por construcción.

function fila(over: Partial<FilaPuntaje> = {}): FilaPuntaje {
  return {
    tipo: "mensual",
    periodo_inicio: "2026-07-01",
    total_pct: 88,
    puntualidad_pct: 90,
    asistencia_pct: 95,
    calidad_pct: 80,
    herramientas_pct: 100,
    posicion: 2,
    mercaderistas_evaluados: 12,
    hay_empate: 0,
    paradas_evaluables: 20,
    paradas_asistidas: 19,
    paradas_con_hora: 18,
    paradas_puntuales: 16,
    campos_obligatorios: 40,
    campos_respondidos: 36,
    fotos_esperadas: 10,
    fotos_presentes: 8,
    items_checklist: 5,
    items_cumplidos: 5,
    calculado_at: "2026-08-03T15:30:00.000Z",
    cerrado_at: null,
    ...over,
  };
}

describe("resolverPeriodicidad", () => {
  it("toma la configuración vigente más reciente que no supere el día", () => {
    const tipo = resolverPeriodicidad(
      [
        { periodicidad: "mensual", vigente_desde: "2026-01-01" },
        { periodicidad: "trimestral", vigente_desde: "2026-06-01" },
        // Futura: todavía no rige.
        { periodicidad: "anual", vigente_desde: "2026-12-01" },
      ],
      "2026-07-15",
    );
    expect(tipo).toBe("trimestral");
  });

  it("sin configuración cae a mensual, como el default de la base", () => {
    expect(resolverPeriodicidad([], "2026-07-15")).toBe("mensual");
  });

  it("una periodicidad desconocida no se propaga: cae a mensual", () => {
    // Una réplica vieja tras un OTA puede traer un valor que esta versión no
    // conoce. Vale más un periodo por defecto que un `tipo` que no case con nada
    // y deje la pantalla vacía sin explicación.
    const tipo = resolverPeriodicidad(
      [{ periodicidad: "quincenal", vigente_desde: "2026-01-01" }],
      "2026-07-15",
    );
    expect(tipo).toBe("mensual");
  });
});

describe("periodoVigente", () => {
  it("sin filas devuelve null", () => {
    expect(periodoVigente([], "mensual")).toBeNull();
  });

  it("devuelve el periodo más reciente de ESA periodicidad", () => {
    const filas = [
      fila({ periodo_inicio: "2026-06-01" }),
      fila({ periodo_inicio: "2026-07-01" }),
      // El 1 de enero es inicio de las tres periodicidades: si no se filtrara
      // por tipo, esta anual podría colarse como "la más reciente".
      fila({ tipo: "anual", periodo_inicio: "2026-01-01" }),
    ];
    expect(periodoVigente(filas, "mensual")?.periodo_inicio).toBe("2026-07-01");
    expect(periodoVigente(filas, "anual")?.periodo_inicio).toBe("2026-01-01");
  });
});

describe("serieDeEvolucion", () => {
  it("ordena del más reciente al más antiguo y compara con el previo", () => {
    const serie = serieDeEvolucion(
      [
        fila({ periodo_inicio: "2026-05-01", posicion: 5 }),
        fila({ periodo_inicio: "2026-06-01", posicion: 3 }),
        fila({ periodo_inicio: "2026-07-01", posicion: 4 }),
      ],
      "mensual",
    );

    expect(serie.map((p) => p.periodo_inicio)).toEqual([
      "2026-07-01",
      "2026-06-01",
      "2026-05-01",
    ]);
    expect(serie[0]!.etiqueta).toBe("Julio 2026");
    // De 3.º a 4.º: bajó uno.
    expect(serie[0]!.delta).toBe("▼ 1");
    expect(serie[0]!.deltaDescripcion).toBe("baja 1 puesto");
    // De 5.º a 3.º: subió dos.
    expect(serie[1]!.delta).toBe("▲ 2");
    expect(serie[1]!.deltaDescripcion).toBe("sube 2 puestos");
  });

  it("el periodo más antiguo no tiene con qué compararse", () => {
    const serie = serieDeEvolucion([fila({ posicion: 1 })], "mensual");
    expect(serie[0]!.delta).toBe("—");
    expect(serie[0]!.deltaDescripcion).toBe("sin comparación");
  });

  it("un hueco de periodos compara contra la última vez que SÍ hubo puntaje", () => {
    // Mayo y julio, sin junio: la comparación honesta es contra mayo, no contra
    // un junio inventado en cero.
    const serie = serieDeEvolucion(
      [
        fila({ periodo_inicio: "2026-05-01", posicion: 4 }),
        fila({ periodo_inicio: "2026-07-01", posicion: 2 }),
      ],
      "mensual",
    );
    expect(serie).toHaveLength(2);
    expect(serie[0]!.delta).toBe("▲ 2");
  });
});

describe("textoDeMiPosicion", () => {
  it("dice el puesto y el denominador", () => {
    expect(textoDeMiPosicion(3, 12, false)).toBe("3.º de 12");
  });

  it("marca el empate", () => {
    expect(textoDeMiPosicion(2, 12, true)).toBe("2.º (empate) de 12");
  });

  it("sin posición es «Sin datos», nunca el último puesto", () => {
    expect(textoDeMiPosicion(null, 12, false)).toBe("Sin datos");
  });

  it("con un solo evaluado no hay comparación que hacer", () => {
    // "1.º de 1" es ruido con forma de logro.
    expect(textoDeMiPosicion(1, 1, false)).toBe("Sin comparación");
    expect(textoDeMiPosicion(1, null, false)).toBe("Sin comparación");
  });
});

describe("formatearPct", () => {
  it("usa coma decimal y una cifra", () => {
    expect(formatearPct(88)).toBe("88,0");
    expect(formatearPct(91.56)).toBe("91,6");
    expect(formatearPct(91.44)).toBe("91,4");
  });

  it("un nulo NUNCA se pinta como 0", () => {
    // Un no evaluado pintado como cero le dice al mercaderista que lo hizo fatal.
    expect(formatearPct(null)).toBe("Sin datos");
    expect(formatearPct(null)).not.toContain("0");
  });
});

describe("desglosePorVariable", () => {
  it("da las cuatro variables vivas con su cobertura", () => {
    const vars = desglosePorVariable(fila());
    expect(vars.map((v) => v.clave)).toEqual([
      "puntualidad",
      "asistencia",
      "calidad",
      "herramientas",
    ]);
    expect(vars[0]!.detalle).toBe("16 de 18 a tiempo");
    expect(vars[1]!.detalle).toBe("19 de 20 visitadas");
    // Calidad suma campos y fotos: 36+8 de 40+10.
    expect(vars[2]!.detalle).toBe("44 de 50 datos y fotos");
  });

  it("una variable no evaluada llega como null, no como 0", () => {
    const vars = desglosePorVariable(fila({ calidad_pct: null }));
    expect(vars.find((v) => v.clave === "calidad")?.pct).toBeNull();
  });

  it("sin nada que evaluar lo dice en vez de enseñar «0 de 0»", () => {
    const vars = desglosePorVariable(
      fila({ items_checklist: 0, items_cumplidos: 0 }),
    );
    expect(vars.find((v) => v.clave === "herramientas")?.detalle).toBe(
      "sin nada que evaluar",
    );
  });
});

describe("textoFrescura", () => {
  const CALCULADO = "2026-08-03T20:30:00.000Z"; // 15:30 en Lima

  it("conectado, solo dice cuándo lo calculó el servidor", () => {
    const t = textoFrescura(CALCULADO, new Date(), true);
    expect(t).toBe("Calculado el 3 ago, 15:30");
    expect(t).not.toContain("Sin conexión");
  });

  it("sin conexión, dice ADEMÁS cuándo sincronizó el teléfono", () => {
    // El caso que los distingue: puntaje del 3 de agosto en un teléfono sin
    // señal desde el 10. El número es exacto y aun así puede estar viejo.
    const t = textoFrescura(
      CALCULADO,
      new Date("2026-08-10T14:00:00.000Z"),
      false,
    );
    expect(t).toContain("Sin conexión");
    expect(t).toContain("última sincronización 10 ago");
    expect(t).toContain("Calculado el 3 ago");
  });

  it("arranque en frío sin señal: lo dice, no finge que la réplica está vacía", () => {
    // El SDK reinicia `lastSyncedAt` al arrancar, así que un nulo aquí NO
    // significa que no haya datos en disco.
    const t = textoFrescura(CALCULADO, null, false);
    expect(t).toContain("sin sincronizar en esta sesión");
    expect(t).toContain("Calculado el 3 ago");
  });
});

describe("fechaCorta", () => {
  it("usa la zona de Lima, no la del dispositivo ni UTC", () => {
    // 00:30 UTC del 4 de agosto es todavía el 3 de agosto en Lima (UTC-5).
    expect(fechaCorta("2026-08-04T00:30:00.000Z")).toBe("3 ago, 19:30");
  });

  it("una fecha ilegible no revienta la pantalla", () => {
    expect(fechaCorta("no es una fecha")).toBe("—");
  });
});
