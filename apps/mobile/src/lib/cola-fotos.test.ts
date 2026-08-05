import { describe, expect, it } from "@jest/globals";

import { ColaFotos, type AlmacenManifiesto } from "./cola-fotos";

// Un almacén en memoria: prueba la lógica de la cola sin tocar disco.
function almacenMemoria(inicial: string | null = null): AlmacenManifiesto {
  let contenido = inicial;
  return {
    leer: () => Promise.resolve(contenido),
    escribir: (c) => {
      contenido = c;
      return Promise.resolve();
    },
  };
}

const VISITA = "a0000010-0000-0000-0000-000000000001";
const YO = "44444444-4444-4444-4444-444444444444";

/** Los ids llevan la forma del seed: no cumplen los bits de versión del RFC 9562. */
const idDe = (n: string) => `a0000015-0000-0000-0000-00000000000${n}`;

const foto = (n: string) => ({
  id: idDe(n),
  ruta: `/docs/fotos/${idDe(n)}.jpg`,
  hash: `hash-${n}`,
  visita_id: VISITA,
  mercaderista_id: YO,
  encolada_at: "2026-07-21T12:00:00.000Z",
  intentos: 0,
  proximo_intento_at: null,
  requiere_atencion: false,
});

describe("ColaFotos", () => {
  it("empieza vacía", async () => {
    const cola = new ColaFotos(almacenMemoria());
    expect(await cola.contarPendientes()).toBe(0);
  });

  it("encolar suma; marcar subida resta", async () => {
    const cola = new ColaFotos(almacenMemoria());
    await cola.encolar(foto("a"));
    await cola.encolar(foto("b"));
    expect(await cola.contarPendientes()).toBe(2);

    await cola.marcarSubida(idDe("a"));
    expect(await cola.contarPendientes()).toBe(1);
  });

  it("encolar es idempotente por id: no duplica", async () => {
    // Al reintentar tras un fallo, la misma foto no debe contarse dos veces.
    const cola = new ColaFotos(almacenMemoria());
    await cola.encolar(foto("a"));
    await cola.encolar(foto("a"));
    expect(await cola.contarPendientes()).toBe(1);
  });

  it("un manifiesto corrupto se trata como vacío, no tumba la app", async () => {
    const cola = new ColaFotos(almacenMemoria("no es json {"));
    expect(await cola.contarPendientes()).toBe(0);
    // Y sigue usable.
    await cola.encolar(foto("a"));
    expect(await cola.contarPendientes()).toBe(1);
  });

  it("avisa a los suscriptores del nuevo total al cambiar", async () => {
    const cola = new ColaFotos(almacenMemoria());
    const vistos: number[] = [];
    cola.suscribir((n) => vistos.push(n));

    await cola.encolar(foto("a"));
    await cola.encolar(foto("b"));
    await cola.marcarSubida(idDe("a"));

    expect(vistos).toEqual([1, 2, 1]);
  });

  it("marcar subida de algo que no está no rompe ni cambia el total", async () => {
    const cola = new ColaFotos(almacenMemoria());
    await cola.encolar(foto("a"));
    await cola.marcarSubida("no-existe");
    expect(await cola.contarPendientes()).toBe(1);
  });

  it("descarta una entrada de un build anterior en vez de arrastrarla", async () => {
    // Sin `visita_id` no se puede pedir su firma: se quedaría reintentando con un
    // 400 para siempre. El archivo no se pierde — la reconciliación lo reencuentra
    // por su ruta, que se deduce del id de la fila.
    const vieja = JSON.stringify([
      {
        id: idDe("a"),
        ruta: "/x.jpg",
        hash: "h",
        encolada_at: "2026-07-21T12:00:00.000Z",
      },
      foto("b"),
    ]);
    const cola = new ColaFotos(almacenMemoria(vieja));
    const pendientes = await cola.listarPendientes();
    expect(pendientes.map((f) => f.id)).toEqual([idDe("b")]);
  });

  it("dos escrituras concurrentes no se pisan", async () => {
    // El subidor (concurrencia 2) escribe a la vez que el wizard encola: sin la
    // serialización, una actualización perdida resucita una foto ya subida.
    const cola = new ColaFotos(almacenMemoria());
    await Promise.all([
      cola.encolar(foto("a")),
      cola.encolar(foto("b")),
      cola.encolar(foto("c")),
    ]);
    expect(await cola.contarPendientes()).toBe(3);
  });

  it("marcarIntento cuenta el intento y fija cuándo reintentar", async () => {
    const cola = new ColaFotos(almacenMemoria());
    await cola.encolar(foto("a"));

    await cola.marcarIntento(idDe("a"), {
      proximoIntentoAt: "2026-07-21T12:05:00.000Z",
    });

    const [p] = await cola.listarPendientes();
    expect(p?.intentos).toBe(1);
    expect(p?.proximo_intento_at).toBe("2026-07-21T12:05:00.000Z");
    // Sigue en la cola: un fallo no descarta evidencia de campo.
    expect(await cola.contarPendientes()).toBe(1);
  });

  it("reintentarTodas deja todo elegible ya", async () => {
    const cola = new ColaFotos(almacenMemoria());
    await cola.encolar(foto("a"));
    await cola.marcarIntento(idDe("a"), {
      proximoIntentoAt: "2099-01-01T00:00:00.000Z",
    });

    await cola.reintentarTodas();

    const [p] = await cola.listarPendientes();
    expect(p?.proximo_intento_at).toBeNull();
    // El contador de intentos NO se borra: es historial, no un obstáculo.
    expect(p?.intentos).toBe(1);
  });
});
