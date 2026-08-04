import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DiaPlaneado } from "@/lib/panel/ruteros";

import { DiaRutero } from "./dia-rutero";

const acciones = vi.hoisted(() => ({
  agregarParada: vi.fn(),
  publicarRutero: vi.fn(),
  quitarParada: vi.fn(),
  reordenarParadas: vi.fn(),
}));

vi.mock("@/lib/panel/acciones-ruteros", () => acciones);

const TIENDAS = [
  { id: "t1", nombre: "Plaza Vea Surco" },
  { id: "t2", nombre: "Tottus Angamos" },
];

function dia(over: Partial<DiaPlaneado> = {}): DiaPlaneado {
  return {
    fecha: "2026-08-03",
    ruteroId: "r1",
    estado: "borrador",
    paradas: [
      { id: "a", orden: 1, tiendaId: "t1", tiendaNombre: "Plaza Vea Surco" },
      { id: "b", orden: 2, tiendaId: "t2", tiendaNombre: "Tottus Angamos" },
    ],
    ...over,
  };
}

function pintar(d: DiaPlaneado) {
  return render(<DiaRutero dia={d} mercaderistaId="m1" tiendas={TIENDAS} />);
}

beforeEach(() => {
  for (const fn of Object.values(acciones)) fn.mockReset();
});

describe("DiaRutero", () => {
  it("lista las paradas en orden y numeradas", () => {
    pintar(dia());
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Plaza Vea Surco");
    expect(items[1]).toHaveTextContent("Tottus Angamos");
  });

  it("subir manda la lista COMPLETA en el orden nuevo", async () => {
    // Se manda la lista entera y no "sube esta una posición": dos supervisores
    // con operaciones relativas sobre el mismo rutero se pisarían.
    acciones.reordenarParadas.mockResolvedValue({ ok: true });
    pintar(dia());

    fireEvent.click(screen.getByRole("button", { name: /Subir Tottus/ }));

    await waitFor(() =>
      expect(acciones.reordenarParadas).toHaveBeenCalledWith({
        ruteroId: "r1",
        paradas: ["b", "a"],
      }),
    );
  });

  it("en los extremos, los botones de orden van deshabilitados", () => {
    pintar(dia());
    expect(
      screen.getByRole("button", { name: /Subir Plaza Vea/ }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /Bajar Tottus/ })).toBeDisabled();
  });

  it("cada botón dice QUÉ parada mueve, no solo la flecha", () => {
    // El símbolo es decorativo: con un lector de pantalla, seis botones "↑" en
    // una lista no dicen nada.
    pintar(dia());
    expect(
      screen.getByRole("button", { name: "Bajar Plaza Vea Surco" }),
    ).toBeInTheDocument();
  });

  it("añadir una tienda la asigna a ese día", async () => {
    acciones.agregarParada.mockResolvedValue({ ok: true });
    pintar(dia());

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "t2" } });

    await waitFor(() =>
      expect(acciones.agregarParada).toHaveBeenCalledWith({
        mercaderistaId: "m1",
        fecha: "2026-08-03",
        tiendaId: "t2",
      }),
    );
  });

  it("un borrador con paradas se puede publicar", () => {
    pintar(dia());
    expect(
      screen.getByRole("button", { name: "Publicar" }),
    ).toBeInTheDocument();
  });

  it("un día vacío no ofrece publicar: no significaría nada", () => {
    pintar(dia({ paradas: [] }));
    expect(
      screen.queryByRole("button", { name: "Publicar" }),
    ).not.toBeInTheDocument();
  });

  it("un rutero EN CURSO no se replanifica ni se republica", () => {
    // El mercaderista está en la calle con él.
    pintar(dia({ estado: "en_curso" }));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Subir/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Publicar" }),
    ).not.toBeInTheDocument();
  });

  it("si el servidor rechaza, lo dice en vez de tragárselo", async () => {
    acciones.publicarRutero.mockResolvedValue({
      ok: false,
      error: "No encontrado o sin permiso",
    });
    pintar(dia());

    fireEvent.click(screen.getByRole("button", { name: "Publicar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No encontrado o sin permiso",
    );
  });
});
