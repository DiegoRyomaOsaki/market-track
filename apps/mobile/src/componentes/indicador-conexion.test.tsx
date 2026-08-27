import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

import type { EstadoSync } from "@/lib/powersync/estado";

// Los tres hooks que consume el indicador tocan cosas que no existen en Jest:
// `expo-router` necesita el árbol de navegación, y los otros dos, la réplica
// nativa de PowerSync y la cola de fotos en disco. Se moquean para probar lo
// único que vive DENTRO del componente: qué se pinta para cada estado.
jest.mock("expo-router", () => ({ useRouter: jest.fn() }));
jest.mock("@/lib/powersync/estado", () => ({ useEstadoSync: jest.fn() }));
jest.mock("@/lib/cola-fotos-instancia", () => ({ useCountFotos: jest.fn() }));

import { useRouter } from "expo-router";

import { useCountFotos } from "@/lib/cola-fotos-instancia";
import { useEstadoSync } from "@/lib/powersync/estado";

import { IndicadorConexion } from "./indicador-conexion";

const mockUseRouter = jest.mocked(useRouter);
const mockUseEstadoSync = jest.mocked(useEstadoSync);
const mockUseCountFotos = jest.mocked(useCountFotos);

const push = jest.fn();

/** El estado que devuelve el hook, con lo que cada test necesita cambiar. */
function estado(parcial: Partial<EstadoSync> = {}): EstadoSync {
  return {
    conectado: true,
    subiendo: false,
    bajando: false,
    pendientesRegistros: 0,
    ultimaSync: null,
    ...parcial,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseRouter.mockReturnValue({ push } as unknown as ReturnType<
    typeof useRouter
  >);
  mockUseEstadoSync.mockReturnValue(estado());
  mockUseCountFotos.mockReturnValue(0);
});

describe("IndicadorConexion", () => {
  describe("el rótulo de estado", () => {
    it("dice «Sin conexión» cuando el teléfono no alcanza al servidor", async () => {
      mockUseEstadoSync.mockReturnValue(estado({ conectado: false }));

      await render(<IndicadorConexion />);

      expect(screen.getByText("Sin conexión")).toBeTruthy();
    });

    it("dice «En línea» cuando hay conexión y ninguna cola se está moviendo", async () => {
      mockUseEstadoSync.mockReturnValue(estado({ conectado: true }));

      await render(<IndicadorConexion />);

      expect(screen.getByText("En línea")).toBeTruthy();
    });

    it("dice «Sincronizando…» mientras sube", async () => {
      mockUseEstadoSync.mockReturnValue(
        estado({ conectado: true, subiendo: true }),
      );

      await render(<IndicadorConexion />);

      expect(screen.getByText("Sincronizando…")).toBeTruthy();
    });

    it("dice «Sincronizando…» también cuando lo que se mueve es la bajada", async () => {
      mockUseEstadoSync.mockReturnValue(
        estado({ conectado: true, bajando: true }),
      );

      await render(<IndicadorConexion />);

      expect(screen.getByText("Sincronizando…")).toBeTruthy();
    });

    it("prioriza «Sin conexión» sobre el trabajo en curso: sin red no se está sincronizando nada", async () => {
      mockUseEstadoSync.mockReturnValue(
        estado({ conectado: false, subiendo: true, bajando: true }),
      );

      await render(<IndicadorConexion />);

      expect(screen.getByText("Sin conexión")).toBeTruthy();
      expect(screen.queryByText("Sincronizando…")).toBeNull();
    });
  });

  describe("las dos colas", () => {
    // Que registros y fotos se cuenten por separado es el punto del indicador
    // (ADR-0001): deja ver que una visita ya subió mientras sus fotos siguen
    // esperando señal. Un solo total escondería justo eso.
    it("cuenta registros y fotos por separado, sin mezclarlos", async () => {
      mockUseEstadoSync.mockReturnValue(estado({ pendientesRegistros: 3 }));
      mockUseCountFotos.mockReturnValue(7);

      await render(<IndicadorConexion />);

      expect(
        screen.getByLabelText("3 registros pendientes de subir"),
      ).toBeTruthy();
      expect(screen.getByLabelText("7 fotos pendientes de subir")).toBeTruthy();
    });

    it("muestra la visita ya subida con sus fotos aún en cola", async () => {
      mockUseEstadoSync.mockReturnValue(estado({ pendientesRegistros: 0 }));
      mockUseCountFotos.mockReturnValue(4);

      await render(<IndicadorConexion />);

      expect(
        screen.getByLabelText("0 registros pendientes de subir"),
      ).toBeTruthy();
      expect(screen.getByLabelText("4 fotos pendientes de subir")).toBeTruthy();
    });

    // El chip cambia de color según haya o no pendientes; el número es lo que
    // lo dice sin depender del color (WCAG 1.4.1).
    it("el número pendiente se lee como texto, no solo por el color del chip", async () => {
      mockUseEstadoSync.mockReturnValue(estado({ pendientesRegistros: 12 }));
      mockUseCountFotos.mockReturnValue(0);

      await render(<IndicadorConexion />);

      expect(screen.getByText("12")).toBeTruthy();
      expect(screen.getByText("0")).toBeTruthy();
    });
  });

  it("lleva a la pantalla de sincronización al tocarlo", async () => {
    await render(<IndicadorConexion />);

    // Por rol + nombre, no solo por etiqueta: así el test también se cae si
    // alguien quita el `accessibilityRole` y deja la etiqueta puesta.
    // `fireEvent` devuelve promesa en RNTL 14, igual que `render`.
    await fireEvent.press(
      screen.getByRole("button", { name: "Ver estado de sincronización" }),
    );

    expect(push).toHaveBeenCalledWith("/sincronizacion");
  });

  // Control negativo del ARNÉS, no del componente. Ojo con lo que NO es: el
  // fallo que motivó este archivo —un `render()` sin `await`— lo atrapan antes
  // `tsc` y `no-floating-promises`, no esta prueba (ver CLAUDE.md). Lo que sí
  // cubre es el caso genérico de que las consultas acierten contra un árbol que
  // no es el del componente: un árbol en blanco haría pasar en vacío a las
  // aserciones negativas de arriba, y esta se cae.
  it("el arnés monta un árbol real: una consulta imposible falla", async () => {
    await render(<IndicadorConexion />);

    expect(screen.getByText("En línea")).toBeTruthy();
    expect(() =>
      screen.getByText("un texto que el indicador nunca pinta"),
    ).toThrow();
  });
});
