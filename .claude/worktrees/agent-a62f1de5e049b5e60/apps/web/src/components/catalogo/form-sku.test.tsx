import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FormSku } from "./form-sku";

// La categoría del SKU: opcional, y acotada al cliente de la marca elegida.
//
// La FK compuesta `(categoria_id, tenant_id)` impide de verdad apuntar a la
// categoría de otro cliente; lo que se prueba aquí es que el formulario no
// ofrezca —ni mande— una que el servidor va a rechazar.

const { crear } = vi.hoisted(() => ({ crear: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/catalogo/acciones", () => ({
  crearSku: crear,
  editarSku: vi.fn(),
}));

const MARACUMANGO = "aaaaaaaa-0000-0000-0000-000000000001";
const RIVAL = "bbbbbbbb-0000-0000-0000-000000000002";

const MARCAS = [
  {
    id: "m-mrc",
    nombre: "Maracumango",
    tenant_id: MARACUMANGO,
    cliente: "Maracumango",
  },
  {
    id: "m-riv",
    nombre: "Marca Rival",
    tenant_id: RIVAL,
    cliente: "Cliente Rival",
  },
];

const CATEGORIAS = [
  { id: "c-mrc", nombre: "Bebidas", tenant_id: MARACUMANGO },
  { id: "c-riv", nombre: "Snacks del rival", tenant_id: RIVAL },
];

function pintar() {
  return render(<FormSku marcas={MARCAS} categorias={CATEGORIAS} />);
}

function rellenar() {
  fireEvent.change(screen.getByLabelText("Nombre del SKU"), {
    target: { value: "Néctar 1L" },
  });
  fireEvent.change(screen.getByLabelText("Código"), {
    target: { value: "MRC-001" },
  });
}

function enviar() {
  fireEvent.submit(screen.getByRole("button", { name: /Crear/ }));
}

beforeEach(() => {
  crear.mockReset();
  crear.mockResolvedValue({ ok: true });
});

describe("FormSku — categoría", () => {
  it("solo ofrece las categorías del cliente de la marca elegida", () => {
    pintar();

    expect(screen.getByRole("option", { name: "Bebidas" })).toBeTruthy();
    expect(
      screen.queryByRole("option", { name: "Snacks del rival" }),
    ).toBeNull();
  });

  it("al cambiar de marca cambian las categorías ofrecidas", () => {
    pintar();
    fireEvent.change(screen.getByLabelText("Marca"), {
      target: { value: "m-riv" },
    });

    expect(
      screen.getByRole("option", { name: "Snacks del rival" }),
    ).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Bebidas" })).toBeNull();
  });

  it("cambiar a la marca de OTRO cliente descarta la categoría elegida", () => {
    // Deja de verse al filtrarse la lista, pero seguiría en el estado y viajaría
    // en el envío — y la base lo rechazaría con un 23503 que no dice nada.
    pintar();
    fireEvent.change(screen.getByLabelText(/Categoría/), {
      target: { value: "c-mrc" },
    });
    fireEvent.change(screen.getByLabelText("Marca"), {
      target: { value: "m-riv" },
    });

    expect(screen.getByLabelText(/Categoría/)).toHaveValue("");
  });

  it("sin categoría manda null, no una cadena vacía", async () => {
    // La columna es nullable; una cadena vacía no es un uuid y la base la
    // rechazaría.
    pintar();
    rellenar();
    enviar();

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0]?.[0]).toMatchObject({ categoria_id: null });
  });

  it("con categoría manda su id junto al tenant de la marca", async () => {
    pintar();
    rellenar();
    fireEvent.change(screen.getByLabelText(/Categoría/), {
      target: { value: "c-mrc" },
    });
    enviar();

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0]?.[0]).toMatchObject({
      categoria_id: "c-mrc",
      tenant_id: MARACUMANGO,
    });
  });

  it("un cliente sin categorías lo dice en vez de dejar el desplegable mudo", () => {
    render(<FormSku marcas={MARCAS} categorias={[]} />);

    expect(
      screen.getByText(/no tiene categorías todavía/i),
    ).toBeInTheDocument();
  });
});
