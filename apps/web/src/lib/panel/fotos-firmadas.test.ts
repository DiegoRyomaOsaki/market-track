import { beforeEach, describe, expect, it, vi } from "vitest";

import { urlsFirmadas } from "./fotos-firmadas";

// El orquestador del firmado de evidencia. Degrada de tres formas distintas —lote
// rechazado por la Edge Function, excepción, plazo agotado— y las tres acaban en
// "sigue con lo que tengas". Sin tests, cualquiera de las tres se vuelve un
// silencio.

const invoke = vi.fn();

// Solo se usa `functions.invoke`; el resto del cliente no interviene.
const cliente = { functions: { invoke } } as unknown as Parameters<
  typeof urlsFirmadas
>[0];

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `foto-${i}`);
}

type Opciones = { body: { foto_ids: string[] } };

/** Responde como la Edge Function: un mapa de las fotos pedidas. */
function firmar(opciones: Opciones) {
  return Promise.resolve({
    data: {
      urls: Object.fromEntries(
        opciones.body.foto_ids.map((id) => [id, `https://r2/${id}`]),
      ),
    },
    error: null,
  });
}

/** La firma real: `invoke(nombre, opciones)`. */
function firmando() {
  return (_nombre: unknown, opciones: Opciones) => firmar(opciones);
}

beforeEach(() => {
  invoke.mockReset();
  vi.restoreAllMocks();
});

describe("urlsFirmadas", () => {
  it("sin fotos no llama a nadie", async () => {
    await expect(urlsFirmadas(cliente, [])).resolves.toEqual({});
    expect(invoke).not.toHaveBeenCalled();
  });

  it("firma un lote y devuelve el mapa", async () => {
    invoke.mockImplementation(firmando());
    await expect(urlsFirmadas(cliente, ["a", "b"])).resolves.toEqual({
      a: "https://r2/a",
      b: "https://r2/b",
    });
  });

  it("trocea en lotes de 50: uno mayor lo rechazaría ENTERO", async () => {
    invoke.mockImplementation(firmando());
    const resultado = await urlsFirmadas(cliente, ids(120));

    expect(invoke).toHaveBeenCalledTimes(3);
    const tamanos = invoke.mock.calls.map(
      (c) => (c[1] as { body: { foto_ids: string[] } }).body.foto_ids.length,
    );
    expect(tamanos).toEqual([50, 50, 20]);
    expect(Object.keys(resultado)).toHaveLength(120);
  });

  it("los lotes van en PARALELO, no en serie", async () => {
    // Con los lotes en serie, el peor caso es N × plazo. Este test cuenta cuántos
    // hay en vuelo a la vez: si alguien vuelve al bucle secuencial, baja a 1.
    let enVuelo = 0;
    let maximo = 0;
    invoke.mockImplementation(async (...args: unknown[]) => {
      enVuelo += 1;
      maximo = Math.max(maximo, enVuelo);
      await Promise.resolve();
      enVuelo -= 1;
      return firmar(args[1] as Opciones);
    });

    await urlsFirmadas(cliente, ids(120));

    expect(maximo).toBe(3);
  });

  it("un lote que falla no se lleva por delante a los que firmaron", async () => {
    // Media evidencia se revisa; ninguna, no.
    let llamada = 0;
    invoke.mockImplementation((...args: unknown[]) => {
      llamada += 1;
      if (llamada === 1) {
        return Promise.resolve({ data: null, error: { message: "boom" } });
      }
      return firmar(args[1] as Opciones);
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const resultado = await urlsFirmadas(cliente, ids(60));

    // El primer lote (50) se pierde; el segundo (10) llega.
    expect(Object.keys(resultado)).toHaveLength(10);
  });

  it("una excepción del SDK tampoco tumba el resto", async () => {
    let llamada = 0;
    invoke.mockImplementation((...args: unknown[]) => {
      llamada += 1;
      if (llamada === 1) return Promise.reject(new Error("red caída"));
      return firmar(args[1] as Opciones);
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(urlsFirmadas(cliente, ids(60))).resolves.toHaveProperty(
      "foto-59",
    );
  });

  it("si nada responde a tiempo, devuelve vacío en vez de colgarse", async () => {
    vi.useFakeTimers();
    invoke.mockReturnValue(new Promise(() => undefined));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const promesa = urlsFirmadas(cliente, ["a"]);
    await vi.advanceTimersByTimeAsync(11_000);

    await expect(promesa).resolves.toEqual({});
    vi.useRealTimers();
  });

  it("el mensaje del fallo se registra recortado, no crudo", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: new Error("x".repeat(500)),
    });
    const registro = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await urlsFirmadas(cliente, ["a"]);

    expect(String(registro.mock.calls[0]?.[1])).toHaveLength(200);
  });
});
