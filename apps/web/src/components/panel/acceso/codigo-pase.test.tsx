import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CodigoPase } from "./codigo-pase";

// El código solo vive aquí, en memoria. Lo que se prueba es que la cuenta atrás
// diga la verdad y que el componente no deje un temporizador suelto.

const AHORA = new Date("2026-08-07T15:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
});

function pintar(props: Partial<Parameters<typeof CodigoPase>[0]> = {}) {
  return render(
    <CodigoPase
      codigo="482913"
      expiraAt="2026-08-07T15:15:00.000Z"
      {...props}
    />,
  );
}

describe("CodigoPase", () => {
  it("enseña el código y avisa de que no se vuelve a ver", () => {
    pintar();
    expect(screen.getByText("482913")).toBeInTheDocument();
    expect(screen.getByText(/no se puede volver a ver/i)).toBeInTheDocument();
  });

  it("arranca la cuenta desde la hora de expiración, no desde un número fijo", () => {
    pintar();
    expect(screen.getByText("15:00")).toBeInTheDocument();
  });

  it("descuenta con el reloj", () => {
    pintar();
    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByText("13:55")).toBeInTheDocument();
  });

  it("se recalcula contra `expira_at`: una pestaña dormida no desvía la cuenta", () => {
    // Solo corre UN tick de intervalo, pero el reloj saltó cinco minutos. Si el
    // componente decrementara un contador marcaría 14:59; al recalcular contra
    // `expira_at` refleja el salto (15:15 menos 15:05:01 = 09:59).
    pintar();
    act(() => {
      vi.setSystemTime(new Date("2026-08-07T15:05:00.000Z"));
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("09:59")).toBeInTheDocument();
  });

  it("al vencer OCULTA el código y lo anuncia", () => {
    pintar();
    act(() => {
      vi.advanceTimersByTime(15 * 60 * 1000);
    });

    expect(screen.queryByText("482913")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/venció/i);
  });

  it("avisa al padre para que la bitácora pase a «vencido»", () => {
    const alVencer = vi.fn();
    pintar({ alVencer });

    act(() => {
      vi.advanceTimersByTime(15 * 60 * 1000);
    });

    expect(alVencer).toHaveBeenCalled();
  });

  it("no canta cada segundo a un lector de pantalla", () => {
    // Un `aria-live` en el contador taparía todo lo demás de la pantalla.
    pintar();
    expect(screen.getByText("15:00")).toHaveAttribute("aria-live", "off");
  });

  it("limpia el temporizador al desmontar", () => {
    const limpiar = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = pintar();
    unmount();
    expect(limpiar).toHaveBeenCalled();
  });
});
