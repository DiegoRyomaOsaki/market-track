import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VistaPreviaPuntaje } from "./vista-previa-puntaje";

const VACIO = "Todavía no hay puntajes que re-ponderar.";

describe("VistaPreviaPuntaje", () => {
  it("la limitación se lee SIEMPRE, no solo tras calcular", () => {
    // Quien cambia el objetivo de share of shelf y ve el mismo número tiene que
    // saber por qué antes de concluir que la pantalla no funciona.
    render(<VistaPreviaPuntaje onCalcular={vi.fn()} textoVacio={VACIO} />);
    expect(screen.getByText(/no recalcula las variables/i)).toBeTruthy();
  });

  it("muestra el actual, el previsto y la dirección del cambio en TEXTO", () => {
    // La dirección no puede ir solo en el color (WCAG 1.4.1).
    const onCalcular = vi.fn().mockResolvedValue({
      ok: true,
      previa: {
        etiqueta: "Plaza Vea Salaverry",
        detalle: "Calculado el 1/8/2026",
        actual: 80,
        previsto: 92.5,
      },
    });
    render(<VistaPreviaPuntaje onCalcular={onCalcular} textoVacio={VACIO} />);

    fireEvent.click(screen.getByRole("button", { name: /ver efecto/i }));

    return waitFor(() => {
      expect(screen.getByText("Plaza Vea Salaverry")).toBeTruthy();
      expect(screen.getByText(/sube 12\.50/)).toBeTruthy();
    });
  });

  it("dice 'baja' cuando el puntaje empeora", () => {
    const onCalcular = vi.fn().mockResolvedValue({
      ok: true,
      previa: { etiqueta: "T", detalle: "d", actual: 90, previsto: 70 },
    });
    render(<VistaPreviaPuntaje onCalcular={onCalcular} textoVacio={VACIO} />);
    fireEvent.click(screen.getByRole("button", { name: /ver efecto/i }));
    return waitFor(() => expect(screen.getByText(/baja 20\.00/)).toBeTruthy());
  });

  it("sin puntajes explica POR QUÉ está vacío, no un 'sin datos' genérico", () => {
    const onCalcular = vi.fn().mockResolvedValue({ ok: true, previa: null });
    render(<VistaPreviaPuntaje onCalcular={onCalcular} textoVacio={VACIO} />);
    fireEvent.click(screen.getByRole("button", { name: /ver efecto/i }));
    return waitFor(() => expect(screen.getByText(VACIO)).toBeTruthy());
  });

  it("un fallo se anuncia como alerta", () => {
    const onCalcular = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "No se pudo calcular" });
    render(<VistaPreviaPuntaje onCalcular={onCalcular} textoVacio={VACIO} />);
    fireEvent.click(screen.getByRole("button", { name: /ver efecto/i }));
    return waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "No se pudo calcular",
      ),
    );
  });

  it("no ofrece el botón cuando está deshabilitado", () => {
    render(
      <VistaPreviaPuntaje
        onCalcular={vi.fn()}
        textoVacio={VACIO}
        deshabilitado
      />,
    );
    expect(
      screen
        .getByRole("button", { name: /ver efecto/i })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
