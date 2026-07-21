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

const foto = (id: string) => ({
  id,
  ruta: `/tmp/${id}.jpg`,
  hash: `hash-${id}`,
  encolada_at: "2026-07-21T12:00:00.000Z",
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

    await cola.marcarSubida("a");
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
    await cola.marcarSubida("a");

    expect(vistos).toEqual([1, 2, 1]);
  });

  it("marcar subida de algo que no está no rompe ni cambia el total", async () => {
    const cola = new ColaFotos(almacenMemoria());
    await cola.encolar(foto("a"));
    await cola.marcarSubida("no-existe");
    expect(await cola.contarPendientes()).toBe(1);
  });
});
