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

const espia = vi.hoisted(() => {
  const orden: string[] = [];
  const retirados: string[] = [];

  // Con la compuerta puesta, `setAuth` se queda esperando: así se puede
  // desmontar el componente en mitad del arranque.
  let compuerta: Promise<void> | null = null;
  let abrir: (() => void) | null = null;

  const cliente = {
    realtime: {
      setAuth: vi.fn(async () => {
        if (compuerta) await compuerta;
        orden.push("setAuth");
      }),
    },
    channel: vi.fn((topico: string, opciones: unknown) => {
      orden.push(`channel:${topico}`);
      const canal = {
        topico,
        opciones,
        on: vi.fn(() => canal),
        subscribe: vi.fn(() => {
          orden.push(`subscribe:${topico}`);
          return canal;
        }),
      };
      return canal;
    }),
    removeChannel: vi.fn((canal: { topico: string }) => {
      retirados.push(canal.topico);
      return Promise.resolve("ok");
    }),
  };

  return {
    cliente,
    orden,
    retirados,
    frenarSetAuth: () => {
      compuerta = new Promise<void>((r) => (abrir = r));
    },
    soltarSetAuth: () => abrir?.(),
    reiniciar: () => {
      orden.length = 0;
      retirados.length = 0;
      compuerta = null;
      abrir = null;
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

// El mapa trae MapLibre y WebGL, que no existen en jsdom, y aquí no se prueba.
vi.mock("@/components/mapa/mapa-pines", () => ({
  MapaPines: () => <div data-testid="mapa" />,
}));

// Es un módulo de Server Actions: importarlo de verdad arrastra el runtime del
// servidor a un test de navegador.
vi.mock("@/lib/panel/acciones-tablero", () => ({
  marcarContingenciaAtendida: vi.fn(),
}));

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

beforeEach(() => {
  espia.reiniciar();
});

describe("TableroVivo — suscripción en vivo", () => {
  it("autentica el socket ANTES de pedir ningún canal", async () => {
    // Sin `setAuth()` primero, Realtime no evalúa la RLS y rechaza el canal
    // privado. El orden es el contrato, no un detalle de escritura.
    montar();
    await esperarSuscripcion();

    expect(espia.orden.indexOf("setAuth")).toBe(0);
    expect(espia.orden.indexOf("setAuth")).toBeLessThan(
      espia.orden.indexOf("channel:staff:visita"),
    );
    expect(espia.orden.indexOf("setAuth")).toBeLessThan(
      espia.orden.indexOf("channel:staff:alerta"),
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

    await waitFor(() => expect(espia.retirados).toHaveLength(2));
    expect(espia.retirados).toEqual(
      expect.arrayContaining(["staff:visita", "staff:alerta"]),
    );
  });

  it("si se sale antes de que conteste setAuth, no deja ningún canal abierto", async () => {
    // La carrera real: el supervisor entra al tablero y navega fuera enseguida.
    // Si el efecto se suscribiera igual, nadie retiraría esos canales — la
    // limpieza ya se habría ejecutado.
    espia.frenarSetAuth();
    const { unmount } = montar();
    unmount();

    espia.soltarSetAuth();
    await waitFor(() =>
      expect(espia.cliente.realtime.setAuth).toHaveBeenCalledTimes(1),
    );

    expect(espia.cliente.channel).not.toHaveBeenCalled();
    expect(espia.retirados).toHaveLength(0);
  });
});
