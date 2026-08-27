import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Contingencia } from "@/lib/panel/tablero";

import { FeedContingencias } from "./feed-contingencias";

// El criterio de aceptación del ticket vive aquí: el badge de no atendidas y el
// botón que lo decrementa. La lógica pura ya está probada en `tablero.test.ts`;
// esto comprueba el circuito completo contra el DOM, incluido lo que pasa cuando
// el servidor dice que no.

const marcar = vi.hoisted(() => vi.fn());

vi.mock("@/lib/panel/acciones-tablero", () => ({
  marcarContingenciaAtendida: marcar,
}));

function contingencia(over: Partial<Contingencia> = {}): Contingencia {
  return {
    id: "c1",
    visita_id: "v1",
    tienda_nombre: "Plaza Vea Surco",
    mercaderista_nombre: "Ana",
    paso: "precios",
    motivo: "Góndola en remodelación",
    estado: "nueva",
    creado_at: "2026-08-03T14:30:00Z",
    ...over,
  };
}

beforeEach(() => {
  marcar.mockReset();
});

describe("FeedContingencias", () => {
  it("el badge cuenta las que faltan por atender", () => {
    render(
      <FeedContingencias
        contingencias={[
          contingencia({ id: "a" }),
          contingencia({ id: "b", estado: "resuelta" }),
        ]}
        onAtendida={vi.fn()}
      />,
    );
    expect(screen.getByText("1 sin atender")).toBeInTheDocument();
  });

  it("sin contingencias lo dice, en vez de dejar el hueco vacío", () => {
    render(<FeedContingencias contingencias={[]} onAtendida={vi.fn()} />);
    expect(screen.getByText("Sin pendientes")).toBeInTheDocument();
    expect(
      screen.getByText(/El levantamiento va completo/),
    ).toBeInTheDocument();
  });

  it("una contingencia que entra sube el badge sin recargar la página", () => {
    // Es lo que hace Realtime: llegan props nuevas y el badge sube solo.
    const { rerender } = render(
      <FeedContingencias
        contingencias={[contingencia({ id: "a" })]}
        onAtendida={vi.fn()}
      />,
    );
    expect(screen.getByText("1 sin atender")).toBeInTheDocument();

    rerender(
      <FeedContingencias
        contingencias={[contingencia({ id: "a" }), contingencia({ id: "b" })]}
        onAtendida={vi.fn()}
      />,
    );
    expect(screen.getByText("2 sin atender")).toBeInTheDocument();
  });

  it("marcar atendida avisa al padre para que baje el badge", async () => {
    marcar.mockResolvedValue({ ok: true });
    const onAtendida = vi.fn();
    render(
      <FeedContingencias
        contingencias={[contingencia({ id: "c1" })]}
        onAtendida={onAtendida}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /marcar atendida/i }));

    await waitFor(() => expect(onAtendida).toHaveBeenCalledWith("c1"));
    expect(marcar).toHaveBeenCalledWith({ id: "c1" });
  });

  it("si el servidor la rechaza, lo dice y NO la da por atendida", async () => {
    // El caso peligroso: fallar en silencio dejaría al supervisor creyendo que
    // cerró una contingencia que sigue abierta.
    marcar.mockResolvedValue({
      ok: false,
      error: "No encontrado o sin permiso",
    });
    const onAtendida = vi.fn();
    render(
      <FeedContingencias
        contingencias={[contingencia({ id: "c1" })]}
        onAtendida={onAtendida}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /marcar atendida/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No encontrado o sin permiso",
    );
    expect(onAtendida).not.toHaveBeenCalled();
    // Esperado, no comprobado a secas: `setError` va DENTRO de `iniciar(...)`,
    // así que el botón se vuelve a habilitar cuando termina la transición, que
    // no tiene por qué ser el mismo render en el que aparece la alerta.
    // Asertarlo de forma síncrona daba por hecho que React vacía las dos cosas a
    // la vez; en una máquina lenta no siempre, y el test se caía enseñando el
    // botón todavía en «Marcando…».
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /marcar atendida/i }),
      ).toBeEnabled(),
    );
  });

  it("la ya atendida muestra su confirmación en vez del botón", () => {
    render(
      <FeedContingencias
        contingencias={[contingencia({ estado: "resuelta" })]}
        onAtendida={vi.fn()}
      />,
    );
    expect(screen.getByText("Atendida")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /marcar atendida/i }),
    ).not.toBeInTheDocument();
  });
});
