import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Solicitud } from "@/lib/panel/solicitudes";

import { FilaSolicitud } from "./fila-solicitud";

// El circuito de resolver una solicitud contra el DOM: que el comentario sea de
// verdad obligatorio, que aprobar y rechazar se distingan, y que un rechazo del
// servidor se vea.

const resolver = vi.hoisted(() => vi.fn());

vi.mock("@/lib/panel/acciones-solicitudes", () => ({
  resolverSolicitud: resolver,
}));

function solicitud(over: Partial<Solicitud> = {}): Solicitud {
  return {
    id: "a0000020-0000-0000-0000-000000000001",
    mercaderista_id: "m1",
    mercaderista_nombre: "Ana",
    tipo: "cambio_dia",
    motivo: "Tienda cerrada por inventario",
    estado: "nueva",
    fecha: null,
    rutero_fecha: null,
    comentario_resolucion: null,
    resuelta_por_nombre: null,
    resuelta_at: null,
    creada_at: "2026-08-04T14:00:00Z",
    ...over,
  };
}

function escribirComentario(texto: string) {
  fireEvent.change(screen.getByLabelText(/comentario para/i), {
    target: { value: texto },
  });
}

beforeEach(() => {
  resolver.mockReset();
});

describe("FilaSolicitud", () => {
  it("muestra el motivo y quién lo pide", () => {
    render(<FilaSolicitud solicitud={solicitud()} onResuelta={vi.fn()} />);
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(
      screen.getByText("Tienda cerrada por inventario"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Cambio de día/)).toBeInTheDocument();
  });

  it("sin comentario avisa por qué, en vez de un botón muerto", async () => {
    // El botón se queda habilitado a propósito: uno deshabilitado no se puede
    // enfocar y no dice POR QUÉ lo está, así que con teclado se pasaba de largo.
    const onResuelta = vi.fn();
    render(<FilaSolicitud solicitud={solicitud()} onResuelta={onResuelta} />);

    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /comentario antes de resolver/i,
    );
    expect(resolver).not.toHaveBeenCalled();
    expect(onResuelta).not.toHaveBeenCalled();
  });

  it("solo espacios no cuenta como comentario", async () => {
    render(<FilaSolicitud solicitud={solicitud()} onResuelta={vi.fn()} />);
    escribirComentario("   ");
    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('el "Guardando…" sale en el botón que se pulsó, no en el otro', async () => {
    // Con un solo booleano compartido, rechazar ponía \"Guardando…\" sobre Aprobar
    // — la UI decía que estaba pasando algo que no era.
    let resolverPromesa: (v: unknown) => void = () => {};
    resolver.mockReturnValue(
      new Promise((res) => {
        resolverPromesa = res;
      }),
    );
    render(<FilaSolicitud solicitud={solicitud()} onResuelta={vi.fn()} />);

    escribirComentario("No procede");
    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));

    expect(
      await screen.findByRole("button", { name: "Guardando…" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprobar" })).toBeInTheDocument();

    resolverPromesa({
      ok: true,
      resueltaAt: "2026-08-04T15:00:00Z",
      resueltaPorNombre: "Carla",
    });
  });

  it("aprobar envía la decisión y avisa al padre", async () => {
    resolver.mockResolvedValue({
      ok: true,
      resueltaAt: "2026-08-04T15:00:00Z",
      resueltaPorNombre: "Carla",
    });
    const onResuelta = vi.fn();
    render(<FilaSolicitud solicitud={solicitud()} onResuelta={onResuelta} />);

    escribirComentario("Aprobado, ajusto el rutero");
    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }));

    await waitFor(() =>
      expect(onResuelta).toHaveBeenCalledWith(
        expect.objectContaining({ estado: "resuelta" }),
      ),
    );
    expect(resolver).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "resuelta" }),
    );
  });

  it("rechazar manda la otra decisión, no la misma", async () => {
    resolver.mockResolvedValue({
      ok: true,
      resueltaAt: "2026-08-04T15:00:00Z",
      resueltaPorNombre: "Carla",
    });
    render(<FilaSolicitud solicitud={solicitud()} onResuelta={vi.fn()} />);

    escribirComentario("No procede esta semana");
    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));

    await waitFor(() =>
      expect(resolver).toHaveBeenCalledWith(
        expect.objectContaining({ decision: "rechazada" }),
      ),
    );
  });

  it("si el servidor la rechaza, lo dice y no la da por resuelta", async () => {
    resolver.mockResolvedValue({
      ok: false,
      error: "No encontrada o sin permiso",
    });
    const onResuelta = vi.fn();
    render(<FilaSolicitud solicitud={solicitud()} onResuelta={onResuelta} />);

    escribirComentario("Aprobado");
    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No encontrada o sin permiso",
    );
    expect(onResuelta).not.toHaveBeenCalled();
  });

  it("la ya resuelta muestra quién decidió y lleva a ajustar el rutero", () => {
    render(
      <FilaSolicitud
        solicitud={solicitud({
          estado: "resuelta",
          resuelta_por_nombre: "Carla",
          resuelta_at: "2026-08-04T15:00:00Z",
          comentario_resolucion: "Aprobado, ajusto el rutero",
        })}
        onResuelta={vi.fn()}
      />,
    );
    expect(screen.getByText(/Aprobada por Carla/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Ajustar el rutero de Ana/ }),
    ).toHaveAttribute("href", "/supervisor/ruteros");
    expect(
      screen.queryByRole("button", { name: "Aprobar" }),
    ).not.toBeInTheDocument();
  });

  it("la rechazada no ofrece ajustar el rutero: no hay nada que ajustar", () => {
    render(
      <FilaSolicitud
        solicitud={solicitud({
          estado: "rechazada",
          resuelta_por_nombre: "Carla",
          comentario_resolucion: "No procede",
        })}
        onResuelta={vi.fn()}
      />,
    );
    expect(screen.getByText(/Rechazada por Carla/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
