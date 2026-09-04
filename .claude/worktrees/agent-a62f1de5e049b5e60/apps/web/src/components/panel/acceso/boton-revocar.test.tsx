import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BotonRevocar } from "./boton-revocar";

const { revocar, refresh } = vi.hoisted(() => ({
  revocar: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/panel/acciones-acceso", () => ({ revocarPase: revocar }));

const PASE = "a0000020-0000-0000-0000-000000000001";

function pintar() {
  return render(<BotonRevocar paseId={PASE} usuario="José Quispe" />);
}

function pulsar() {
  fireEvent.click(screen.getByRole("button", { name: /Revocar el pase/ }));
}

beforeEach(() => {
  revocar.mockReset();
  refresh.mockReset();
  revocar.mockResolvedValue({ ok: true });
});

describe("BotonRevocar", () => {
  it("dice a QUIÉN pertenece el pase que revoca", () => {
    // La bitácora pinta un botón por fila: sin esto, quien navega por la lista
    // de botones ve N entradas idénticas llamadas «Revocar».
    pintar();
    expect(
      screen.getByRole("button", { name: "Revocar el pase de José Quispe" }),
    ).toBeInTheDocument();
  });

  it("revoca el pase de su fila, no otro", async () => {
    pintar();
    pulsar();
    await waitFor(() => expect(revocar).toHaveBeenCalledWith({ paseId: PASE }));
  });

  it("mientras está en vuelo se deshabilita y lo dice", async () => {
    // Sin esto, dos clics seguidos mandan dos revocaciones.
    let resolver: (v: { ok: boolean }) => void = () => {};
    revocar.mockReturnValue(
      new Promise<{ ok: boolean }>((r) => {
        resolver = r;
      }),
    );
    pintar();
    pulsar();

    // El nombre accesible lo fija el `aria-label`, no el texto visible.
    const boton = screen.getByRole("button", { name: /Revocar el pase/ });
    await waitFor(() => expect(boton).toBeDisabled());
    expect(boton).toHaveTextContent("Revocando…");

    resolver({ ok: true });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("al revocar refresca para que la fila pase a «revocado»", async () => {
    pintar();
    pulsar();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("si falla lo dice y NO refresca como si hubiera ido bien", async () => {
    // Pasa de verdad: el pase pudo vencer entre que se pintó la fila y el clic.
    revocar.mockResolvedValue({
      ok: false,
      error: "El pase ya no está vigente",
    });
    pintar();
    pulsar();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /ya no está vigente/,
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("la región de error existe desde el primer render, aunque esté vacía", () => {
    pintar();
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });
});
