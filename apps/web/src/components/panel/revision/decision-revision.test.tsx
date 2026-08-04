import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DecisionRevision } from "./decision-revision";

const { revisarVisita } = vi.hoisted(() => ({ revisarVisita: vi.fn() }));

vi.mock("@/lib/panel/acciones-revision", () => ({ revisarVisita }));

function pintar(over: Partial<Parameters<typeof DecisionRevision>[0]> = {}) {
  return render(
    <DecisionRevision
      visitaId="v1"
      revisionInicial={null}
      evidenciaPendiente={0}
      {...over}
    />,
  );
}

function escribirMotivo(texto: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: texto } });
}

beforeEach(() => {
  revisarVisita.mockReset();
});

describe("DecisionRevision", () => {
  it("un reporte sin revisar lo dice", () => {
    pintar();
    expect(screen.getByText(/todavía no se ha revisado/)).toBeInTheDocument();
  });

  it("aprobar no exige motivo", async () => {
    revisarVisita.mockResolvedValue({
      ok: true,
      revisorNombre: "Ana Torres",
      revisadoAt: "2026-08-05T10:00:00Z",
    });
    pintar();

    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }));

    await waitFor(() =>
      expect(revisarVisita).toHaveBeenCalledWith({
        visitaId: "v1",
        decision: "aprobada",
        motivo: "",
      }),
    );
  });

  it("rechazar SIN motivo no llama al servidor y explica por qué", async () => {
    pintar();

    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Explica por qué se rechaza",
    );
    expect(revisarVisita).not.toHaveBeenCalled();
  });

  it("el botón de rechazar NO se deshabilita para forzar el motivo", () => {
    // Un botón deshabilitado no se enfoca y no explica por qué: se pulsa y se
    // explica.
    pintar();
    expect(screen.getByRole("button", { name: "Rechazar" })).not.toBeDisabled();
  });

  it("rechazar con motivo lo manda recortado", async () => {
    revisarVisita.mockResolvedValue({
      ok: true,
      revisorNombre: "Ana Torres",
      revisadoAt: "2026-08-05T10:00:00Z",
    });
    pintar();

    escribirMotivo("  Falta la foto Después  ");
    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));

    await waitFor(() =>
      expect(revisarVisita).toHaveBeenCalledWith({
        visitaId: "v1",
        decision: "rechazada",
        motivo: "Falta la foto Después",
      }),
    );
  });

  it("tras decidir muestra quién decidió y cuándo", async () => {
    revisarVisita.mockResolvedValue({
      ok: true,
      revisorNombre: "Ana Torres",
      revisadoAt: "2026-08-05T15:00:00Z",
    });
    pintar();

    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }));

    expect(
      await screen.findByText(/Aprobada por Ana Torres/),
    ).toBeInTheDocument();
  });

  it("una revisión que ya venía puesta se muestra al entrar", () => {
    pintar({
      revisionInicial: {
        decision: "rechazada",
        motivo: "Falta la foto Después",
        revisorNombre: "Ana Torres",
        revisadoAt: "2026-08-05T15:00:00Z",
      },
    });
    expect(screen.getByText(/Rechazada por Ana Torres/)).toBeInTheDocument();
    // Y el motivo queda cargado para poder corregirlo sin reescribirlo entero.
    expect(screen.getByRole("textbox")).toHaveValue("Falta la foto Después");
  });

  it("avisa de la evidencia que sigue en el teléfono, sin bloquear", () => {
    // Un bloqueo duro dejaría reportes irrevisables si la cola a R2 se atasca.
    pintar({ evidenciaPendiente: 3 });
    expect(screen.getByText(/3 fotos sin subir/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprobar" })).not.toBeDisabled();
  });

  it("sin evidencia pendiente no mete ruido", () => {
    pintar({ evidenciaPendiente: 0 });
    expect(screen.queryByText(/sin subir/)).not.toBeInTheDocument();
  });

  it("si el servidor rechaza, lo dice en vez de tragárselo", async () => {
    revisarVisita.mockResolvedValue({
      ok: false,
      error: "No encontrada o sin permiso",
    });
    pintar();

    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No encontrada o sin permiso",
    );
  });

  it("mientras guarda lo dice y no admite otra pulsación", async () => {
    let resolver: (r: unknown) => void = () => {};
    revisarVisita.mockReturnValue(
      new Promise((r) => {
        resolver = r;
      }),
    );
    pintar();

    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }));

    const enVuelo = await screen.findByRole("button", { name: "Guardando…" });
    expect(enVuelo).toBeDisabled();
    resolver({
      ok: true,
      revisorNombre: "Ana",
      revisadoAt: "2026-08-05T15:00:00Z",
    });
  });
});
