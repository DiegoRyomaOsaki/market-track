import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EstadoDeAlerta } from "./estado-alerta";

const { marcar, refresh } = vi.hoisted(() => ({
  marcar: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/portal/acciones-alertas", () => ({
  marcarEstadoAlerta: marcar,
}));

const ALERTA = "a0000016-0000-0000-0000-000000000001";

beforeEach(() => {
  marcar.mockReset();
  refresh.mockReset();
  marcar.mockResolvedValue({ ok: true, estado: "vista" });
});

describe("EstadoDeAlerta", () => {
  it("dice en qué estado está y ofrece los otros dos", () => {
    render(<EstadoDeAlerta alertaId={ALERTA} estado="nueva" />);
    expect(screen.getByText("Nueva")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Marcar vista" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Marcar resuelta" }),
    ).toBeInTheDocument();
  });

  it("una resuelta se puede REABRIR: sin auditoría, un clic no es definitivo", () => {
    render(<EstadoDeAlerta alertaId={ALERTA} estado="resuelta" />);
    expect(screen.getByRole("button", { name: "Reabrir" })).toBeInTheDocument();
  });

  it("no ofrece el estado en el que ya está", () => {
    render(<EstadoDeAlerta alertaId={ALERTA} estado="vista" />);
    expect(
      screen.queryByRole("button", { name: "Marcar vista" }),
    ).not.toBeInTheDocument();
  });

  it("al pulsar manda el estado nuevo y refresca la pantalla", async () => {
    render(<EstadoDeAlerta alertaId={ALERTA} estado="nueva" />);
    fireEvent.click(screen.getByRole("button", { name: "Marcar vista" }));

    await waitFor(() =>
      expect(marcar).toHaveBeenCalledWith({
        alertaId: ALERTA,
        estado: "vista",
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("un fallo se ANUNCIA y no se refresca como si hubiera ido bien", async () => {
    marcar.mockResolvedValue({
      ok: false,
      error: "No encontrada o sin permiso",
    });
    render(<EstadoDeAlerta alertaId={ALERTA} estado="nueva" />);

    fireEvent.click(screen.getByRole("button", { name: "Marcar vista" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/sin permiso/);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reintentar borra el error anterior antes de volver a pedirlo", async () => {
    marcar.mockResolvedValue({
      ok: false,
      error: "No encontrada o sin permiso",
    });
    render(<EstadoDeAlerta alertaId={ALERTA} estado="nueva" />);
    fireEvent.click(screen.getByRole("button", { name: "Marcar vista" }));
    await screen.findByRole("alert");

    marcar.mockResolvedValue({ ok: true, estado: "vista" });
    fireEvent.click(screen.getByRole("button", { name: "Marcar vista" }));

    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });
});
