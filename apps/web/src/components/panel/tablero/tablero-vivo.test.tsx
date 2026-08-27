import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TableroVivo } from "./tablero-vivo";

// El ciclo de vida de la suscripción en vivo, que es lo único que no se ve
// mirando la pantalla: si el tablero dejara canales abiertos al navegar fuera,
// no se notaría hasta ver conexiones acumuladas en producción.
//
// El cliente de Supabase se sustituye por un espía que anota el ORDEN de lo que
// pasa: `setAuth()` tiene que ir antes de suscribirse o Realtime no evalúa la
// RLS y rechaza el canal privado.
//
// El espía respeta el contrato real de la librería, que es lo que evita un verde
// falso: `.on()` devuelve el canal para poder encadenar, `.subscribe()` es
// SÍNCRONO (no devuelve promesa) y `removeChannel()` sí devuelve una, resuelta a
// `'ok'`. Comprobado contra los tipos instalados de `@supabase/supabase-js`.

const espia = vi.hoisted(() => {
  const orden: string[] = [];

  const cliente = {
    realtime: {
      setAuth: vi.fn(() => {
        orden.push("setAuth");
        return Promise.resolve();
      }),
    },
    channel: vi.fn((topico: string) => {
      orden.push(`channel:${topico}`);
      const canal = {
        topico,
        on: vi.fn(() => canal),
        subscribe: vi.fn(() => {
          orden.push(`subscribe:${topico}`);
          return canal;
        }),
      };
      return canal;
    }),
    // El parámetro se declara aunque el cuerpo no lo use: es lo que tipa
    // `mock.calls` y deja leer después qué canal se retiró, sin castear. La
    // promesa resuelta a `'ok'` es la respuesta real de la librería.
    removeChannel: vi.fn((_canal: { topico: string }) => Promise.resolve("ok")),
  };

  return {
    cliente,
    orden,
    reiniciar: () => {
      orden.length = 0;
      cliente.realtime.setAuth.mockClear();
      cliente.channel.mockClear();
      cliente.removeChannel.mockClear();
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => espia.cliente,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// Es un módulo de Server Actions: importarlo de verdad arrastra el runtime del
// servidor a un test de navegador.
vi.mock("@/lib/panel/acciones-tablero", () => ({
  marcarContingenciaAtendida: vi.fn(),
}));

/** Sin `urlTiles` el mapa ni se monta, que es lo que aquí interesa. */
function montar() {
  return render(
    <TableroVivo
      filasIniciales={[]}
      contingenciasIniciales={[]}
      urlTiles={undefined}
    />,
  );
}

/** Los dos canales quedan pedidos. Hasta aquí el arranque es asíncrono. */
async function esperarSuscripcion() {
  await waitFor(() => expect(espia.cliente.channel).toHaveBeenCalledTimes(2));
}

/** Los topics que se pasaron a `removeChannel`, en el orden en que se retiraron. */
function topicosRetirados(): string[] {
  return espia.cliente.removeChannel.mock.calls.map(([canal]) => canal.topico);
}

beforeEach(() => {
  espia.reiniciar();
});

describe("TableroVivo — suscripción en vivo", () => {
  it("autentica el socket ANTES de pedir ningún canal", async () => {
    // Sin `setAuth()` primero, Realtime no evalúa la RLS y rechaza el canal
    // privado. El orden es el contrato, no un detalle de escritura.
    montar();
    await esperarSuscripcion();

    expect(espia.orden[0]).toBe("setAuth");
    // Cuáles vienen después importa; en qué orden entre sí, no.
    expect(espia.orden.slice(1)).toEqual(
      expect.arrayContaining(["channel:staff:visita", "channel:staff:alerta"]),
    );
  });

  it("abre los dos feeds de staff, los dos como canal privado", async () => {
    montar();
    await esperarSuscripcion();

    expect(espia.cliente.channel).toHaveBeenCalledWith("staff:visita", {
      config: { private: true },
    });
    expect(espia.cliente.channel).toHaveBeenCalledWith("staff:alerta", {
      config: { private: true },
    });
  });

  it("deja los dos canales suscritos, no solo pedidos", async () => {
    montar();
    await esperarSuscripcion();

    expect(espia.orden).toContain("subscribe:staff:visita");
    expect(espia.orden).toContain("subscribe:staff:alerta");
  });

  it("al desmontar retira LOS DOS canales", async () => {
    // El fallo que este test existe para atrapar: retirar uno y olvidar el otro
    // deja un canal huérfano por cada visita al tablero.
    const { unmount } = montar();
    await esperarSuscripcion();

    unmount();

    await waitFor(() =>
      expect(espia.cliente.removeChannel).toHaveBeenCalledTimes(2),
    );
    expect(topicosRetirados()).toEqual(
      expect.arrayContaining(["staff:visita", "staff:alerta"]),
    );
  });

  it("si se sale antes de que conteste setAuth, no deja ningún canal abierto", async () => {
    // La carrera real: el supervisor entra al tablero y navega fuera enseguida.
    // Si el efecto se suscribiera igual, nadie retiraría esos canales — la
    // limpieza ya se habría ejecutado.
    //
    // La promesa se retiene aquí, no en el espía compartido: un interruptor
    // global haría que olvidarse de soltarlo colgara otro test con un timeout
    // en vez de con una aserción.
    let contestar!: () => void;
    espia.cliente.realtime.setAuth.mockImplementationOnce(
      () => new Promise<void>((resolver) => (contestar = resolver)),
    );

    const { unmount } = montar();
    unmount();
    contestar();

    await waitFor(() =>
      expect(espia.cliente.realtime.setAuth).toHaveBeenCalledTimes(1),
    );
    expect(espia.cliente.channel).not.toHaveBeenCalled();
    expect(espia.cliente.removeChannel).not.toHaveBeenCalled();
  });
});
