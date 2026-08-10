import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FormCanalesOtp } from "./form-canales-otp";

const { guardar } = vi.hoisted(() => ({ guardar: vi.fn() }));

vi.mock("@/lib/panel/acciones-acceso", () => ({
  guardarCanalesOtp: guardar,
}));

function pintar(
  habilitados: Parameters<typeof FormCanalesOtp>[0]["habilitados"] = ["correo"],
) {
  return render(<FormCanalesOtp habilitados={habilitados} />);
}

function enviar() {
  fireEvent.click(screen.getByRole("button", { name: /Guardar política/ }));
}

beforeEach(() => {
  guardar.mockReset();
  guardar.mockResolvedValue({ ok: true });
});

describe("FormCanalesOtp", () => {
  it("el correo va marcado y no se puede desmarcar", () => {
    pintar();
    const correo = screen.getByRole("checkbox", { name: /Correo/ });
    expect(correo).toBeChecked();
    expect(correo).toBeDisabled();
  });

  it("EXPLICA por qué el correo no se toca, en vez de solo deshabilitarlo", () => {
    // Un control deshabilitado sin motivo se lee como un fallo de la pantalla.
    pintar();
    expect(screen.getByText(/único canal que entrega/i)).toBeInTheDocument();
  });

  it("advierte de que SMS y WhatsApp todavía no entregan", () => {
    // Encenderlos no rompe nada, pero tampoco hace nada: decir lo contrario sería
    // documentar lo planeado como si ya funcionara.
    pintar();
    expect(screen.getByText(/todavía no entregan/i)).toBeInTheDocument();
  });

  it("refleja lo que ya estaba guardado", () => {
    pintar(["correo", "whatsapp"]);
    expect(screen.getByRole("checkbox", { name: "WhatsApp" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "SMS" })).not.toBeChecked();
  });

  it("guardar manda los canales elegidos, con el correo siempre dentro", async () => {
    pintar();
    fireEvent.click(screen.getByRole("checkbox", { name: "SMS" }));
    enviar();

    await waitFor(() =>
      expect(guardar).toHaveBeenCalledWith({ canales: ["correo", "sms"] }),
    );
  });

  it("confirma el guardado a un lector de pantalla, no solo visualmente", async () => {
    pintar();
    enviar();
    expect(await screen.findByRole("status")).toHaveTextContent(/guardada/i);
  });

  it("si falla lo dice y no finge que se guardó", async () => {
    guardar.mockResolvedValue({
      ok: false,
      error: "No encontrado o sin permiso",
    });
    pintar();
    enviar();

    expect(await screen.findByRole("alert")).toHaveTextContent(/sin permiso/);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("las dos regiones existen desde el primer render", () => {
    pintar();
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
