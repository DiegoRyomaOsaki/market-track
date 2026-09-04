import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FiltrosGlobales } from "./filtros-globales";

// Los filtros globales conviven con los de sección (el tipo de foto de la
// galería). Aplicar los unos no puede borrar los otros.

const { replace, push, params } = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  params: { actual: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/cliente/galeria",
  useSearchParams: () => params.actual,
}));

const CADENAS = [{ id: "c1", nombre: "Plaza Vea" }];
const TIENDAS = [{ id: "t1", nombre: "Plaza Vea Surco", cadena_id: "c1" }];

function pintar() {
  return render(<FiltrosGlobales cadenas={CADENAS} tiendas={TIENDAS} />);
}

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  params.actual = new URLSearchParams();
});

describe("FiltrosGlobales", () => {
  it("aplicar CONSERVA los filtros de sección", () => {
    // Sin esto, pulsar "Aplicar" en la barra global borraría el tipo de foto que
    // el cliente acababa de elegir en la galería.
    params.actual = new URLSearchParams("tipo=antes");
    pintar();

    fireEvent.submit(
      screen.getByRole("button", { name: /Aplicar/ }).closest("form")!,
    );

    const url = String(push.mock.calls[0]?.[0]);
    expect(url).toContain("tipo=antes");
  });

  it("aplicar con un filtro global lo pone en la URL", () => {
    pintar();
    fireEvent.change(screen.getByLabelText(/Desde/), {
      target: { value: "2026-07-01" },
    });

    fireEvent.submit(
      screen.getByRole("button", { name: /Aplicar/ }).closest("form")!,
    );

    expect(String(push.mock.calls[0]?.[0])).toContain("desde=2026-07-01");
  });

  it("vaciar un filtro global lo QUITA de la URL, no lo deja rancio", () => {
    params.actual = new URLSearchParams("desde=2026-07-01");
    pintar();
    fireEvent.change(screen.getByLabelText(/Desde/), { target: { value: "" } });

    fireEvent.submit(
      screen.getByRole("button", { name: /Aplicar/ }).closest("form")!,
    );

    expect(String(push.mock.calls[0]?.[0])).not.toContain("desde=");
  });
});
