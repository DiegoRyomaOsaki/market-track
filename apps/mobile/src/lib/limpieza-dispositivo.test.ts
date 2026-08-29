import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@powersync/react-native", () => ({
  useQuery: () => ({ data: [], isLoading: false, error: undefined }),
}));

// eslint-disable-next-line no-var
var mockLlavero: Set<string>;

jest.mock("expo-secure-store", () => ({
  setItemAsync: (clave: string) => {
    mockLlavero.add(clave);
    return Promise.resolve();
  },
  getItemAsync: (clave: string) =>
    Promise.resolve(mockLlavero.has(clave) ? "1" : null),
  deleteItemAsync: (clave: string) => {
    mockLlavero.delete(clave);
    return Promise.resolve();
  },
}));

// El prefijo `mock` no es estilo: Jest iza los `jest.mock()` por encima de las
// declaraciones y solo deja que su factory toque variables con ese prefijo.
// eslint-disable-next-line no-var
var mockDisco: Set<string>;

// Un disco de mentira que sabe lo ÚNICO que aquí importa: qué rutas existen.
// Borrar un directorio se lleva lo que cuelga de él, como en el teléfono.
jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  writeAsStringAsync: (ruta: string) => {
    mockDisco.add(ruta);
    return Promise.resolve();
  },
  getInfoAsync: (ruta: string) =>
    Promise.resolve({ exists: mockDisco.has(ruta) }),
  readAsStringAsync: () => Promise.resolve("{}"),
  deleteAsync: (ruta: string) => {
    for (const existente of mockDisco) {
      if (existente === ruta || existente.startsWith(`${ruta}/`)) {
        mockDisco.delete(existente);
      }
    }
    return Promise.resolve();
  },
}));

import { descartarRetiro } from "./paradas-retiradas";
import { guardarVentana } from "./recordar-dispositivo";
import { iniciarTransito } from "./transito";

import {
  DIR_FOTOS,
  RUTA_MANIFIESTO_FOTOS,
  RUTA_MANIFIESTO_TEMPORAL,
  limpiarDispositivo,
} from "./limpieza-dispositivo";

beforeEach(() => {
  mockDisco = new Set<string>();
  mockLlavero = new Set<string>();
});

/** Deja el teléfono como lo dejaría una jornada del mercaderista anterior. */
async function jornadaDelAnterior(): Promise<void> {
  // Estos dos se escriben por el camino REAL de sus módulos: si mañana cambian
  // de nombre de fichero, este test sigue siendo cierto sin tocarlo.
  await iniciarTransito("2026-08-26T14:00:00.000Z");
  await descartarRetiro("parada-1", "2026-08-26");
  // No es un fichero, pero es suyo: la ventana de "recordar este dispositivo"
  // pertenece a la sesión que se va, no a la que llega.
  await guardarVentana(Date.now() + 1000);

  // La cola de fotos se escribe a mano: su módulo arrastra Supabase y PowerSync,
  // y su escritura atómica ya está probada en su propio archivo. Lo que aquí
  // interesa es que estas rutas EXISTAN antes de limpiar.
  mockDisco.add(RUTA_MANIFIESTO_FOTOS);
  mockDisco.add(RUTA_MANIFIESTO_TEMPORAL);
  mockDisco.add(`${DIR_FOTOS}/foto-1.jpg`);
  mockDisco.add(`${DIR_FOTOS}/foto-2.jpg`);
}

describe("limpiarDispositivo", () => {
  it("tras el cambio de mercaderista no queda NINGÚN fichero del anterior", async () => {
    // La aserción es "no queda nada", no "estos dos se borraron": es la
    // diferencia entre cazar el tercer fichero que llegue y volver a olvidarlo.
    await jornadaDelAnterior();
    expect(mockDisco.size).toBeGreaterThan(0);

    await limpiarDispositivo();

    expect([...mockDisco]).toEqual([]);
    expect([...mockLlavero]).toEqual([]);
  });

  it("no falla cuando no hay nada que borrar", async () => {
    // Es el caso normal: un mercaderista que nunca descartó un aviso no tiene
    // fichero de descartes. Que falte no es un error, por eso el borrado es
    // idempotente.
    await expect(limpiarDispositivo()).resolves.toBeUndefined();
    expect([...mockDisco]).toEqual([]);
  });

  it("limpiar dos veces seguidas tampoco falla", async () => {
    await jornadaDelAnterior();

    await limpiarDispositivo();
    await expect(limpiarDispositivo()).resolves.toBeUndefined();
  });
});

describe("el inventario de lo que vive en disco", () => {
  it("ningún otro módulo de la app se fabrica una ruta de disco", () => {
    // El criterio del ticket: añadir un fichero nuevo obliga a pasar por el sitio
    // que los enumera. Esto es lo que lo hace cumplirse — un módulo que se
    // fabrique su propia ruta cae aquí, aunque nadie se acuerde de limpiarla.
    //
    // Se recorre el árbol ENTERO, no una carpeta: `src/lib/powersync/` ya existe,
    // y el próximo módulo de almacenamiento es tan probable que nazca en una
    // subcarpeta como suelto. Y se busca el nombre de la API, no una forma
    // concreta de escribirla: `dir + "x"` o un import desestructurado guardan la
    // misma ruta sin parecerse a una plantilla.
    const fuentes = fuentesDeLaApp();

    // Que el recorrido llegue a las subcarpetas, comprobado sobre una que ya
    // existe. Sin esto, un `readdirSync` que dejara de recursar pasaría en verde
    // sin mirar nada — un guardia vacío es peor que no tener guardia, porque
    // sustituye a la revisión que sí lo habría visto.
    expect(fuentes).toContain(join(__dirname, "powersync", "db.ts"));

    const infractores = fuentes.filter((archivo) =>
      /(?:document|cache)Directory/.test(readFileSync(archivo, "utf8")),
    );

    expect(infractores).toEqual([]);
  });
});

/** Todo el código de la app menos los tests y el dueño del inventario. */
function fuentesDeLaApp(): string[] {
  const raices = [join(__dirname, ".."), join(__dirname, "..", "..", "app")];
  return raices.flatMap((raiz) =>
    readdirSync(raiz, { recursive: true, withFileTypes: true })
      .filter(
        (e) =>
          e.isFile() &&
          /\.tsx?$/.test(e.name) &&
          !e.name.endsWith(".test.ts") &&
          !e.name.endsWith(".test.tsx") &&
          e.name !== "limpieza-dispositivo.ts",
      )
      .map((e) => join(e.parentPath, e.name)),
  );
}
