import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DiaPlaneado } from "@/lib/panel/ruteros";

import { Planeacion } from "./planeacion";

const { duplicarPeriodo, replace } = vi.hoisted(() => ({
  duplicarPeriodo: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@/lib/panel/acciones-ruteros", () => ({
  agregarParada: vi.fn(),
  duplicarPeriodo,
  publicarRutero: vi.fn(),
  quitarParada: vi.fn(),
  reordenarParadas: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

const MERCADERISTAS = [
  { id: "m1", nombre: "José Quispe" },
  { id: "m2", nombre: "Rosa Meza" },
];

const DIAS: DiaPlaneado[] = [
  { fecha: "2026-08-03", ruteroId: "r1", estado: "borrador", paradas: [] },
];

function pintar(over: Partial<Parameters<typeof Planeacion>[0]> = {}) {
  return render(
    <Planeacion
      vista="semana"
      dia="2026-08-03"
      mercaderistaId="m1"
      mercaderistas={MERCADERISTAS}
      tiendas={[]}
      dias={DIAS}
      {...over}
    />,
  );
}

beforeEach(() => {
  duplicarPeriodo.mockReset();
  replace.mockReset();
});

describe("Planeacion", () => {
  it("sin mercaderistas activos no ofrece planificar nada", () => {
    pintar({ mercaderistas: [] });
    expect(
      screen.getByText(/No hay mercaderistas activos/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Mercaderista" }),
    ).not.toBeInTheDocument();
  });

  it("sin mercaderista elegido pide elegir uno antes que pintar un calendario vacío", () => {
    pintar({ mercaderistaId: null });
    expect(screen.getByText(/Elige un mercaderista/)).toBeInTheDocument();
  });

  it("marca la vista actual para un lector de pantalla, no solo con color", () => {
    pintar({ vista: "mes" });
    expect(screen.getByRole("link", { name: "mes" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "semana" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("los enlaces de periodo llevan a la semana anterior y la siguiente", () => {
    pintar();
    expect(
      screen.getByRole("link", { name: "Semana anterior" }),
    ).toHaveAttribute("href", expect.stringContaining("dia=2026-07-27"));
    expect(
      screen.getByRole("link", { name: "Semana siguiente" }),
    ).toHaveAttribute("href", expect.stringContaining("dia=2026-08-10"));
  });

  it("en vista mensual los enlaces saltan de mes, no de semana", () => {
    pintar({ vista: "mes", dia: "2026-08-15" });
    expect(screen.getByRole("link", { name: "Mes siguiente" })).toHaveAttribute(
      "href",
      expect.stringContaining("dia=2026-09-01"),
    );
  });

  it("cambiar de mercaderista REEMPLAZA la URL, no la apila", async () => {
    // Un `<select>` cerrado emite `change` en cada flecha del teclado: con `push`,
    // recorrer la lista dejaría un rastro de entradas que el botón "atrás" tendría
    // que deshacer una a una.
    pintar();
    fireEvent.change(screen.getByRole("combobox", { name: "Mercaderista" }), {
      target: { value: "m2" },
    });
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        expect.stringContaining("mercaderista=m2"),
      ),
    );
  });

  it("copiar la semana desplaza siete días", async () => {
    duplicarPeriodo.mockResolvedValue({ ok: true });
    pintar();
    fireEvent.click(screen.getByRole("button", { name: /Copiar semana/ }));
    await waitFor(() =>
      expect(duplicarPeriodo).toHaveBeenCalledWith({
        mercaderistaId: "m1",
        desde: "2026-08-03",
        hasta: "2026-08-09",
        dias: 7,
      }),
    );
  });

  it("copiar un mes desplaza los días que ese mes tiene, no 30 fijos", async () => {
    // Agosto tiene 31. Con un desplazamiento fijo, septiembre saldría descuadrado.
    duplicarPeriodo.mockResolvedValue({ ok: true });
    pintar({ vista: "mes", dia: "2026-08-15" });
    fireEvent.click(screen.getByRole("button", { name: /Copiar mes/ }));
    await waitFor(() =>
      expect(duplicarPeriodo).toHaveBeenCalledWith(
        expect.objectContaining({
          desde: "2026-08-01",
          hasta: "2026-08-31",
          dias: 31,
        }),
      ),
    );
  });

  it("si copiar falla, lo dice en vez de tragárselo", async () => {
    duplicarPeriodo.mockResolvedValue({
      ok: false,
      error: "No se pudo guardar el cambio",
    });
    pintar();
    fireEvent.click(screen.getByRole("button", { name: /Copiar semana/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo guardar el cambio",
    );
  });

  it("sin mercaderista no se puede copiar un periodo de nadie", () => {
    pintar({ mercaderistaId: null });
    expect(screen.getByRole("button", { name: /Copiar/ })).toBeDisabled();
  });
});
