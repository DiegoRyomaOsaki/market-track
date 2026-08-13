import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FormFormulario } from "./form-formulario";

const crearFormulario = vi.fn<(datos: unknown) => Promise<unknown>>();
vi.mock("@/lib/formularios/acciones", () => ({
  crearFormulario: (datos: unknown): Promise<unknown> => crearFormulario(datos),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const CLIENTE = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  nombre: "Maracumango",
};
const MARCA = {
  id: "bbbbbbbb-0000-0000-0000-000000000002",
  nombre: "Oster",
  tenant_id: CLIENTE.id,
};

beforeEach(() => {
  crearFormulario.mockReset();
  crearFormulario.mockResolvedValue({ ok: true, id: "f1" });
});

// La etiqueta "Cliente" a secas: la del select de marca también contiene la
// palabra ("todas las marcas del cliente") y un regex laxo casaría con las dos.
function montar() {
  render(<FormFormulario clientes={[CLIENTE]} marcas={[MARCA]} />);
  fireEvent.change(screen.getByLabelText(/^cliente$/i), {
    target: { value: CLIENTE.id },
  });
}

const selectMarca = () =>
  screen.getByLabelText<HTMLSelectElement>(/marca \(opcional\)/i);

describe("FormFormulario — ámbito y marca", () => {
  it("cambiar a check-in RESETEA y deshabilita la marca (no la esconde con valor)", () => {
    // La regla de coding_practices: filtrar las opciones de un control no limpia
    // lo ya seleccionado — aquí se limpia de verdad, no solo se deshabilita.
    montar();
    const marca = selectMarca();
    fireEvent.change(marca, { target: { value: MARCA.id } });
    expect(marca.value).toBe(MARCA.id);

    fireEvent.change(screen.getByLabelText(/dónde se usa/i), {
      target: { value: "check_in" },
    });

    expect(marca.value).toBe("");
    expect(marca.disabled).toBe(true);
  });

  it("el submit en check-in manda la marca vacía aunque el select tuviera valor", async () => {
    montar();
    fireEvent.change(selectMarca(), { target: { value: MARCA.id } });
    fireEvent.change(screen.getByLabelText(/dónde se usa/i), {
      target: { value: "check_in" },
    });
    fireEvent.change(screen.getByLabelText(/nombre del formulario/i), {
      target: { value: "Checklist" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /crear|guardar/i }));

    await waitFor(() => expect(crearFormulario).toHaveBeenCalled());
    expect(crearFormulario).toHaveBeenCalledWith(
      expect.objectContaining({ ambito: "check_in", marca_id: "" }),
    );
  });

  it("en levantamiento la marca elegida sí viaja", async () => {
    montar();
    fireEvent.change(selectMarca(), { target: { value: MARCA.id } });
    fireEvent.change(screen.getByLabelText(/nombre del formulario/i), {
      target: { value: "Wizard" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /crear|guardar/i }));

    await waitFor(() => expect(crearFormulario).toHaveBeenCalled());
    expect(crearFormulario).toHaveBeenCalledWith(
      expect.objectContaining({ ambito: "levantamiento", marca_id: MARCA.id }),
    );
  });
});
