import { afterEach, describe, expect, it, jest } from "@jest/globals";

import {
  ColaFotos,
  type AlmacenManifiesto,
  type FotoPendiente,
} from "./cola-fotos";
import {
  ErrorFirmado,
  esperaDeReintento,
  noMejoraReintentando,
  SubidorFotos,
  type DepsSubidor,
} from "./subidor-fotos";

// El subidor de fotos a R2. Todo lo externo entra por `DepsSubidor`, así que
// aquí no hay red, ni disco, ni PowerSync, ni temporizadores reales.

const YO = "44444444-4444-4444-4444-444444444444";
const OTRO = "66666666-6666-6666-6666-666666666666";
const VISITA = "a0000010-0000-0000-0000-000000000001";

function foto(over: Partial<FotoPendiente> = {}): FotoPendiente {
  return {
    id: "a0000015-0000-0000-0000-000000000001",
    ruta: "file:///docs/fotos/a0000015-0000-0000-0000-000000000001.jpg",
    hash: "abc",
    visita_id: VISITA,
    mercaderista_id: YO,
    encolada_at: "2026-08-05T12:00:00.000Z",
    intentos: 0,
    proximo_intento_at: null,
    requiere_atencion: false,
    ...over,
  };
}

/** Un manifiesto en memoria: la cola real, sin disco. */
function almacenMemoria(inicial: FotoPendiente[] = []): AlmacenManifiesto {
  let contenido = JSON.stringify(inicial);
  return {
    leer: () => Promise.resolve(contenido),
    escribir: (c) => {
      contenido = c;
      return Promise.resolve();
    },
  };
}

type Espias = {
  firmados: string[];
  subidas: string[];
  borrados: string[];
  marcadas: string[];
};

// El subidor arma un `setTimeout` para su próximo reintento. Un temporizador vivo
// mantiene el proceso de jest en pie: la suite pasa y luego NO termina, que en CI
// es un job colgado hasta el timeout. Se cancela siempre, gane o falle el test.
let ultimoSubidor: SubidorFotos | null = null;

afterEach(() => {
  ultimoSubidor?.detener();
  ultimoSubidor = null;
  jest.useRealTimers();
});

function montar(
  fotos: FotoPendiente[],
  over: Partial<DepsSubidor> = {},
  opciones: { subir?: (url: string) => Promise<{ estado: number }> } = {},
) {
  const cola = new ColaFotos(almacenMemoria(fotos));
  const espias: Espias = {
    firmados: [],
    subidas: [],
    borrados: [],
    marcadas: [],
  };
  const existentes = new Set(fotos.map((f) => f.ruta));
  const subidasEnReplica = new Set<string>();
  let enVuelo = 0;
  let maxEnVuelo = 0;
  let nFirma = 0;

  const deps: DepsSubidor = {
    cola,
    firmar: (visitaId, fotoId) => {
      espias.firmados.push(fotoId);
      nFirma += 1;
      return Promise.resolve(`https://r2/${fotoId}?firma=${nFirma}`);
    },
    subirBinario: async (url) => {
      enVuelo += 1;
      maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
      espias.subidas.push(url);
      const r = opciones.subir
        ? await opciones.subir(url)
        : { estado: 200 as number };
      enVuelo -= 1;
      return r;
    },
    archivo: {
      existe: (ruta) => Promise.resolve(existentes.has(ruta)),
      borrar: (ruta) => {
        espias.borrados.push(ruta);
        existentes.delete(ruta);
        return Promise.resolve();
      },
    },
    replica: {
      yaSubida: (id) => Promise.resolve(subidasEnReplica.has(id)),
      marcarSubida: (id) => {
        espias.marcadas.push(id);
        subidasEnReplica.add(id);
        return Promise.resolve();
      },
    },
    entorno: {
      conectado: () => true,
      registrosPendientes: () => Promise.resolve(0),
      usuarioId: () => YO,
      ahora: () => Date.parse("2026-08-05T13:00:00.000Z"),
    },
    ...over,
  };

  const subidor = new SubidorFotos(deps);
  ultimoSubidor = subidor;
  return {
    subidor,
    cola,
    espias,
    deps,
    maximo: () => maxEnVuelo,
    subidasEnReplica,
  };
}

describe("esperaDeReintento", () => {
  it("crece con los intentos", () => {
    const a = esperaDeReintento(0, 0.5);
    const b = esperaDeReintento(3, 0.5);
    expect(b).toBeGreaterThan(a);
  });

  it("tiene tope: no crece indefinidamente", () => {
    expect(esperaDeReintento(50, 0.5)).toBe(esperaDeReintento(6, 0.5));
  });

  it("dispersa para que treinta fotos no vuelvan a la vez", () => {
    expect(esperaDeReintento(0, 0)).not.toBe(esperaDeReintento(0, 1));
  });
});

describe("noMejoraReintentando", () => {
  it("solo el 400: es un payload que la función rechaza", () => {
    expect(noMejoraReintentando(400)).toBe(true);
  });

  it("401 y 403 SÍ mejoran: el token se refresca y la visita acaba subiendo", () => {
    expect(noMejoraReintentando(401)).toBe(false);
    expect(noMejoraReintentando(403)).toBe(false);
  });

  it("un 5xx también se reintenta", () => {
    expect(noMejoraReintentando(500)).toBe(false);
  });
});

describe("SubidorFotos", () => {
  it("sube, marca la fila y solo ENTONCES borra el archivo", async () => {
    const { subidor, cola, espias } = montar([foto()]);

    await subidor.arrancar();

    expect(espias.firmados).toHaveLength(1);
    expect(espias.subidas).toHaveLength(1);
    // El orden es la garantía: al revés, morir en medio dejaría el binario en R2
    // sin nadie que lo sepa.
    expect(espias.marcadas).toEqual([foto().id]);
    expect(espias.borrados).toEqual([foto().ruta]);
    expect(await cola.contarPendientes()).toBe(0);
  });

  it("un fallo de red deja la foto en la cola y NO borra el archivo", async () => {
    const { subidor, cola, espias } = montar(
      [foto()],
      {},
      {
        subir: () => Promise.reject(new Error("red caída")),
      },
    );

    await subidor.arrancar();

    expect(espias.borrados).toEqual([]);
    expect(espias.marcadas).toEqual([]);
    const [pendiente] = await cola.listarPendientes();
    expect(pendiente?.intentos).toBe(1);
    expect(pendiente?.proximo_intento_at).toBeTruthy();
    subidor.detener();
  });

  it("si el enlace caducó pide otro y reintenta en el mismo intento", async () => {
    let n = 0;
    const { subidor, cola, espias } = montar(
      [foto()],
      {},
      {
        subir: () => {
          n += 1;
          return Promise.resolve({ estado: n === 1 ? 403 : 200 });
        },
      },
    );

    await subidor.arrancar();

    expect(espias.firmados).toHaveLength(2);
    // Y la segunda URL es distinta de la primera: se pidió una firma nueva.
    expect(espias.subidas[0]).not.toBe(espias.subidas[1]);
    expect(await cola.contarPendientes()).toBe(0);
  });

  it("una foto ya marcada en la réplica no se vuelve a subir", async () => {
    // El proceso murió entre el PUT y el borrado: se limpia, no se re-sube.
    const { subidor, cola, espias, subidasEnReplica } = montar([foto()]);
    subidasEnReplica.add(foto().id);

    await subidor.arrancar();

    expect(espias.firmados).toEqual([]);
    expect(espias.subidas).toEqual([]);
    expect(espias.borrados).toEqual([foto().ruta]);
    expect(await cola.contarPendientes()).toBe(0);
  });

  it("reintentar tras un fallo no duplica ni pierde la foto", async () => {
    let n = 0;
    const { subidor, cola, espias } = montar(
      [foto()],
      {},
      {
        subir: () => {
          n += 1;
          return Promise.resolve({ estado: n === 1 ? 500 : 200 });
        },
      },
    );

    await subidor.arrancar();
    expect(await cola.contarPendientes()).toBe(1);

    // Segunda pasada: la misma entrada, no una nueva.
    await cola.reintentarTodas();
    await subidor.arrancar();

    expect(await cola.contarPendientes()).toBe(0);
    expect(espias.marcadas).toEqual([foto().id]);
    expect(espias.borrados).toHaveLength(1);
  });

  it("sin conexión no hace ni una llamada", async () => {
    const { subidor, espias } = montar([foto()], {
      entorno: {
        conectado: () => false,
        registrosPendientes: () => Promise.resolve(0),
        usuarioId: () => YO,
        ahora: () => 0,
      },
    });

    await subidor.arrancar();

    expect(espias.firmados).toEqual([]);
    expect(espias.subidas).toEqual([]);
  });

  it("espera a que la cola de REGISTROS esté vacía antes de firmar", async () => {
    // Si la visita aún no llegó a Postgres, el firmado responde 403 siempre.
    const { subidor, espias } = montar([foto()], {
      entorno: {
        conectado: () => true,
        registrosPendientes: () => Promise.resolve(3),
        usuarioId: () => YO,
        ahora: () => 0,
      },
    });

    await subidor.arrancar();

    expect(espias.firmados).toEqual([]);
  });

  it("un 403 del firmado es transitorio: no descarta ni borra", async () => {
    const { subidor, cola, espias } = montar([foto()], {
      firmar: () => Promise.reject(new ErrorFirmado(403)),
    });

    await subidor.arrancar();

    expect(espias.borrados).toEqual([]);
    const [p] = await cola.listarPendientes();
    expect(p?.requiere_atencion).toBe(false);
    subidor.detener();
  });

  it("un 400 del firmado se marca para revisar, pero NO borra el archivo", async () => {
    const { subidor, cola, espias } = montar([foto()], {
      firmar: () => Promise.reject(new ErrorFirmado(400)),
    });

    await subidor.arrancar();

    expect(espias.borrados).toEqual([]);
    const [p] = await cola.listarPendientes();
    expect(p?.requiere_atencion).toBe(true);
    subidor.detener();
  });

  it("si el archivo ya no está, se desencola sin marcarla como subida", async () => {
    const { subidor, cola, espias } = montar([foto()], {
      archivo: {
        existe: () => Promise.resolve(false),
        borrar: () => Promise.resolve(),
      },
    });

    await subidor.arrancar();

    // Sale de la cola, pero la fila `foto` NO se marca: el panel la sigue
    // reportando como pendiente, que es la verdad.
    expect(espias.marcadas).toEqual([]);
    expect(await cola.contarPendientes()).toBe(0);
  });

  it("no sube fotos de OTRO mercaderista del mismo teléfono", async () => {
    const { subidor, cola, espias } = montar([foto({ mercaderista_id: OTRO })]);

    await subidor.arrancar();

    expect(espias.firmados).toEqual([]);
    expect(await cola.contarPendientes()).toBe(1);
  });

  it("no pasa de dos subidas a la vez", async () => {
    const fotos = Array.from({ length: 5 }, (_, i) =>
      foto({
        id: `a0000015-0000-0000-0000-00000000000${i}`,
        ruta: `file:///docs/fotos/${i}.jpg`,
      }),
    );
    const { subidor, maximo } = montar(
      fotos,
      {},
      {
        subir: () =>
          new Promise((r) => setTimeout(() => r({ estado: 200 }), 5)),
      },
    );

    await subidor.arrancar();

    expect(maximo()).toBeLessThanOrEqual(2);
    expect(maximo()).toBeGreaterThan(1);
  });

  it("dos arranques a la vez son UNA sola pasada", async () => {
    const { subidor, espias } = montar(
      [foto()],
      {},
      {
        subir: () =>
          new Promise((r) => setTimeout(() => r({ estado: 200 }), 5)),
      },
    );

    await Promise.all([subidor.arrancar(), subidor.arrancar()]);

    expect(espias.subidas).toHaveLength(1);
  });

  it("no toca una foto que todavía está en su espera", async () => {
    const { subidor, espias } = montar([
      foto({ proximo_intento_at: "2026-08-05T23:00:00.000Z", intentos: 2 }),
    ]);

    await subidor.arrancar();

    expect(espias.firmados).toEqual([]);
    subidor.detener();
  });

  it("sin sesión no sube nada", async () => {
    const { subidor, espias } = montar([foto()], {
      entorno: {
        conectado: () => true,
        registrosPendientes: () => Promise.resolve(0),
        usuarioId: () => null,
        ahora: () => 0,
      },
    });

    await subidor.arrancar();

    expect(espias.firmados).toEqual([]);
  });

  it("un borrado que falla no invalida la subida", async () => {
    // La evidencia ya está en R2: queda un huérfano, no una pérdida.
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const { subidor, cola, espias } = montar([foto()], {
      archivo: {
        existe: () => Promise.resolve(true),
        borrar: () => Promise.reject(new Error("disco ocupado")),
      },
    });

    await subidor.arrancar();

    expect(espias.marcadas).toEqual([foto().id]);
    expect(await cola.contarPendientes()).toBe(0);
  });

  it("tras un fallo se reprograma sola: el reintento no espera a un disparador", async () => {
    // Sin esto, una foto que falla queda huérfana hasta que el usuario vuelva a
    // abrir la app o pulse el botón. Verificado por mutación: quitando
    // `programarSiguiente()` este test se pone rojo.
    jest.useFakeTimers();
    let n = 0;
    let ahora = Date.parse("2026-08-05T13:00:00.000Z");
    const { subidor, cola, espias } = montar(
      [foto()],
      {
        entorno: {
          conectado: () => true,
          registrosPendientes: () => Promise.resolve(0),
          usuarioId: () => YO,
          ahora: () => ahora,
        },
      },
      {
        subir: () => {
          n += 1;
          return Promise.resolve({ estado: n === 1 ? 500 : 200 });
        },
      },
    );

    await subidor.arrancar();
    expect(await cola.contarPendientes()).toBe(1);
    expect(espias.subidas).toHaveLength(1);

    // El reloj avanza más allá de la espera del primer fallo y el temporizador
    // dispara la segunda pasada por su cuenta.
    ahora += 60_000;
    await jest.advanceTimersByTimeAsync(60_000);

    expect(espias.subidas).toHaveLength(2);
    expect(await cola.contarPendientes()).toBe(0);
    jest.useRealTimers();
  });

  it("detener() cancela el reintento pendiente", async () => {
    jest.useFakeTimers();
    const cancelar = jest.spyOn(global, "clearTimeout");
    const { subidor } = montar(
      [foto()],
      {},
      {
        subir: () => Promise.resolve({ estado: 500 }),
      },
    );

    await subidor.arrancar();
    subidor.detener();

    expect(cancelar).toHaveBeenCalled();
    cancelar.mockRestore();
    jest.useRealTimers();
  });

  it("si no queda nada esperando, no deja un temporizador colgado", async () => {
    jest.useFakeTimers();
    const { subidor, cola } = montar([foto()]);

    await subidor.arrancar();

    expect(await cola.contarPendientes()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  it("a fuerza de fallos transitorios acaba marcándose para revisar", async () => {
    // No se abandona nunca: sigue reintentando, pero la pantalla lo dice.
    let ahora = Date.parse("2026-08-05T13:00:00.000Z");
    const { subidor, cola } = montar(
      [foto()],
      {
        entorno: {
          conectado: () => true,
          registrosPendientes: () => Promise.resolve(0),
          usuarioId: () => YO,
          ahora: () => ahora,
        },
      },
      { subir: () => Promise.resolve({ estado: 500 }) },
    );

    for (let i = 0; i < 8; i += 1) {
      await cola.reintentarTodas();
      await subidor.arrancar();
      ahora += 1_000_000;
    }
    subidor.detener();

    const [p] = await cola.listarPendientes();
    expect(p?.intentos).toBe(8);
    expect(p?.requiere_atencion).toBe(true);
    // Y sigue en la cola: la evidencia de campo no se abandona por un contador.
    expect(await cola.contarPendientes()).toBe(1);
  });
});
