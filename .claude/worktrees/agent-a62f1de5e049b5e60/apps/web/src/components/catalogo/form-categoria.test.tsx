import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FormCategoria } from "./form-categoria";

// El formulario de categoría. Lo que se prueba es lo que ninguna otra capa cubre:
// qué payload sale de aquí, sobre todo la casilla `activo` — un checkbox ausente
// no viaja en el FormData, así que "desmarcado" y "no enviado" se confunden con
// facilidad.

const { crear } = vi.hoisted(() => ({ crear: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/catalogo/acciones", () => ({
  crearCategoria: crear,
  editarCategoria: vi.fn(),
}));

const MARACUMANGO = "aaaaaaaa-0000-0000-0000-000000000001";
const CLIENTES = [{ id: MARACUMANGO, nombre: "Maracumango" }];

function pintar() {
  return render(<FormCategoria clientes={CLIENTES} />);
}

function rellenar() {
  fireEvent.change(screen.getByLabelText(/Nombre de la categoría/), {
    target: { value: "Bebidas" },
  });
  fireEvent.change(screen.getByLabelText("Cliente"), {
    target: { value: MARACUMANGO },
  });
}

function enviar() {
  fireEvent.submit(screen.getByRole("button", { name: /Crear/ }));
}

beforeEach(() => {
  crear.mockReset();
  crear.mockResolvedValue({ ok: true });
});

describe("FormCategoria", () => {
  it("una categoría nueva nace ACTIVA", async () => {
    pintar();
    rellenar();
    enviar();

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0]?.[0]).toMatchObject({
      nombre: "Bebidas",
      tenant_id: MARACUMANGO,
      activo: true,
    });
  });

  it("desmarcar «Activa» manda false, no la omite", async () => {
    // Un checkbox desmarcado no viaja en el FormData: si el lector no lo tradujo
    // a `false`, la acción recibiría `undefined` y el default la reactivaría.
    pintar();
    rellenar();
    fireEvent.click(screen.getByLabelText("Activa"));
    enviar();

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0]?.[0]).toMatchObject({ activo: false });
  });

  it("avisa de que sin código externo la importación no la reconoce", () => {
    // Es lo que decide si un reimport actualiza esta categoría o crea otra.
    pintar();

    expect(
      screen.getByText(/no puede reconocer esta categoría/i),
    ).toBeInTheDocument();
  });

  it("un error del servidor se enseña y no navega", async () => {
    crear.mockResolvedValue({
      ok: false,
      error: "Ese código externo ya existe para este cliente",
    });
    pintar();
    rellenar();
    enviar();

    expect(
      await screen.findByText(/ya existe para este cliente/),
    ).toBeInTheDocument();
  });

  it("sin clientes lo dice en vez de pintar un formulario que no puede guardar", () => {
    render(<FormCategoria clientes={[]} />);

    expect(screen.getByText(/todavía no hay ninguno/i)).toBeInTheDocument();
  });
});
