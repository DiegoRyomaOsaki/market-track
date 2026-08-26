import { beforeEach, describe, expect, it, jest } from "@jest/globals";

// @powersync/react-native arrastra módulos nativos: se moquea el hook. Aquí se
// prueba la REGLA —qué se anuncia y qué no—, no el motor de sync.
jest.mock("@powersync/react-native", () => ({
  useQuery: () => ({ data: [], isLoading: false, error: undefined }),
}));

// El prefijo `mock` no es estilo: Jest iza los `jest.mock()` por encima de las
// declaraciones y solo deja que su factory toque variables con ese prefijo.
// eslint-disable-next-line no-var
var mockDisco: { contenido: string | null; escrituraFalla: boolean };

jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: () => Promise.resolve({ exists: mockDisco.contenido !== null }),
  readAsStringAsync: () => Promise.resolve(mockDisco.contenido ?? ""),
  writeAsStringAsync: (_ruta: string, c: string) => {
    if (mockDisco.escrituraFalla) return Promise.reject(new Error("disco"));
    mockDisco.contenido = c;
    return Promise.resolve();
  },
}));

import {
  avisosDeRetiro,
  descartadosVigentes,
  descartarRetiro,
  leerDescartes,
  type RetiradaLocal,
} from "./paradas-retiradas";

const HOY = "2026-08-26";

function retirada(over: Partial<RetiradaLocal> = {}): RetiradaLocal {
  return {
    id: "r1",
    tienda_id: "t1",
    fecha: HOY,
    retirada_at: "2026-08-26T12:00:00Z",
    motivo: null,
    tienda_nombre: "Plaza Vea Higuereta",
    ...over,
  };
}

const NADA = new Set<string>();

beforeEach(() => {
  mockDisco = { contenido: null, escrituraFalla: false };
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

describe("avisosDeRetiro", () => {
  it("una parada que desaparece de la ruta produce un aviso con su tienda", () => {
    // El criterio del ticket. No se afirma que la fila se fuera de la réplica
    // —eso ya lo hacía PowerSync en silencio—: se afirma que sale el AVISO.
    const avisos = avisosDeRetiro([retirada()], NADA, NADA);

    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.tienda).toBe("Plaza Vea Higuereta");
  });

  it("la tienda que SIGUE en la ruta no genera aviso", () => {
    // Se la quitaron y se la devolvieron. Anunciar su pérdida sería mentir en
    // la dirección contraria.
    const avisos = avisosDeRetiro([retirada()], NADA, new Set(["t1"]));
    expect(avisos).toEqual([]);
  });

  it("un aviso descartado no vuelve a aparecer", () => {
    const avisos = avisosDeRetiro([retirada()], new Set(["r1"]), NADA);
    expect(avisos).toEqual([]);
  });

  it("sin el nombre de la tienda el aviso sale IGUAL", () => {
    // La pérdida no se calla porque falte un maestro: quedarse sin aviso aquí
    // es volver a la desaparición silenciosa.
    const avisos = avisosDeRetiro(
      [retirada({ tienda_nombre: null })],
      NADA,
      NADA,
    );

    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.tienda).toBe("Una tienda de tu ruta");
  });

  it("el motivo viaja entero, sin truncar", () => {
    // Es lo único que le explica al mercaderista qué pasó.
    const motivo =
      "Se reasignó a otro mercaderista porque la cobertura estaba duplicada";
    const avisos = avisosDeRetiro([retirada({ motivo })], NADA, NADA);
    expect(avisos[0]?.motivo).toBe(motivo);
  });

  it("sin motivo, el aviso sigue diciendo qué tienda y cuándo", () => {
    // `motivo` es nullable en la tabla de auditoría: la rama existe de verdad.
    const avisos = avisosDeRetiro([retirada({ motivo: null })], NADA, NADA);

    expect(avisos[0]?.motivo).toBeNull();
    expect(avisos[0]?.tienda).toBe("Plaza Vea Higuereta");
    expect(avisos[0]?.retirada_at).toBe("2026-08-26T12:00:00Z");
  });

  it("los retiros salen del más reciente al más antiguo", () => {
    const avisos = avisosDeRetiro(
      [
        retirada({
          id: "viejo",
          tienda_id: "t1",
          retirada_at: "2026-08-26T08:00:00Z",
        }),
        retirada({
          id: "nuevo",
          tienda_id: "t2",
          retirada_at: "2026-08-26T15:00:00Z",
        }),
      ],
      NADA,
      NADA,
    );

    expect(avisos.map((a) => a.id)).toEqual(["nuevo", "viejo"]);
  });

  it("la misma tienda retirada dos veces no se anuncia dos veces", () => {
    const avisos = avisosDeRetiro(
      [
        retirada({ id: "a", retirada_at: "2026-08-26T08:00:00Z" }),
        retirada({ id: "b", retirada_at: "2026-08-26T15:00:00Z" }),
      ],
      NADA,
      NADA,
    );

    // Y se queda con el más reciente, que es el que trae el motivo vigente.
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.id).toBe("b");
  });
});

describe("descartadosVigentes", () => {
  it("los descartes de AYER no ocultan el aviso de hoy", () => {
    // El aviso vive el día de la ruta a la que pertenecía; acotar el descarte
    // por día es además lo que poda el fichero sin tener que limpiarlo nunca.
    const vigentes = descartadosVigentes(
      { fecha: "2026-08-25", ids: ["r1"] },
      HOY,
    );
    expect(vigentes.has("r1")).toBe(false);
  });

  it("los descartes de hoy sí valen", () => {
    expect(descartadosVigentes({ fecha: HOY, ids: ["r1"] }, HOY).has("r1")).toBe(
      true,
    );
  });

  it("sin nada guardado no hay nada descartado", () => {
    expect(descartadosVigentes(null, HOY).size).toBe(0);
  });
});

describe("el descarte en disco", () => {
  it("sin fichero, no hay nada descartado", async () => {
    expect((await leerDescartes(HOY)).size).toBe(0);
  });

  it("un fichero ILEGIBLE se lee como «nada descartado»", async () => {
    // Se falla hacia MOSTRAR: un JSON roto no puede convertirse en "ya se lo
    // dijimos" y tragarse el aviso para siempre.
    mockDisco.contenido = "{esto no es json";
    expect((await leerDescartes(HOY)).size).toBe(0);
  });

  it("lo descartado sobrevive a cerrar y reabrir la app", async () => {
    await descartarRetiro("r1", HOY);
    expect((await leerDescartes(HOY)).has("r1")).toBe(true);
  });

  it("descartar un segundo aviso no borra el primero", async () => {
    await descartarRetiro("r1", HOY);
    const vigentes = await descartarRetiro("r2", HOY);

    expect([...vigentes].sort()).toEqual(["r1", "r2"]);
  });

  it("si la escritura falla, el aviso se oculta en esta sesión pero vuelve", async () => {
    // El lado seguro: perder el descarte hace que el aviso reaparezca, que es
    // molesto. Perder el aviso haría que la tienda desapareciera en silencio.
    mockDisco.escrituraFalla = true;
    const vigentes = await descartarRetiro("r1", HOY);

    expect(vigentes.has("r1")).toBe(true);
    expect((await leerDescartes(HOY)).has("r1")).toBe(false);
  });
});
