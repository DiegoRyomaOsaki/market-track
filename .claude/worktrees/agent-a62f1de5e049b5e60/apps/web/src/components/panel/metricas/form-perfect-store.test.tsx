import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FormPerfectStore } from "./form-perfect-store";

const publicar = vi.fn<(datos: unknown) => Promise<unknown>>();
const previsualizar =
  vi.fn<(marca: string, pesos: unknown) => Promise<unknown>>();
vi.mock("@/lib/metricas/acciones", () => ({
  publicarConfigPerfectStore: (d: unknown): Promise<unknown> => publicar(d),
  previsualizarPerfectStore: (m: string, p: unknown): Promise<unknown> =>
    previsualizar(m, p),
}));

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const MARCA = "cccccccc-0000-0000-0000-000000000001";
const CATEGORIA = {
  id: "a0000004-0000-0000-0000-000000000001",
  nombre: "Bebidas",
};

beforeEach(() => {
  publicar.mockReset();
  publicar.mockResolvedValue({ ok: true });
  previsualizar.mockReset();
  previsualizar.mockResolvedValue({ ok: true, previa: null });
});

function montar(soloLectura = false) {
  render(
    <FormPerfectStore
      tenantId={TENANT}
      marcaId={MARCA}
      categorias={[CATEGORIA]}
      soloLectura={soloLectura}
      hoy="2026-08-13"
    />,
  );
}

describe("FormPerfectStore", () => {
  it("publica una versión con el alcance y los pesos", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /publicar versión/i }));

    return waitFor(() => {
      expect(publicar).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: TENANT,
          marca_id: MARCA,
          // Sin afinar: aplica a todas las categorías y tipos.
          categoria_id: null,
          tipo_tienda: null,
          vigente_desde: "2026-08-13",
        }),
      );
    });
  });

  it("unos pesos que no suman 100 no llegan al servidor y el error lo dice", () => {
    montar();
    const distribucion = screen.getByDisplayValue("30");
    fireEvent.change(distribucion, { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: /publicar versión/i }));

    return waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/sumar 100/i);
      expect(publicar).not.toHaveBeenCalled();
    });
  });

  it("el contador de pesos avisa en vivo de que no cuadran", () => {
    montar();
    expect(screen.getByText("Suman 100.00 de 100")).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue("30"), {
      target: { value: "40" },
    });
    expect(screen.getByText("Suman 110.00 de 100")).toBeTruthy();
  });

  it("cada peso enlaza su explicación con aria-describedby", () => {
    // Enlazada y no en un popover: el lector de pantalla la lee al enfocar el
    // campo, sin tener que abrir nada.
    montar();
    const distribucion = screen.getByDisplayValue("30");
    const idAyuda = distribucion.getAttribute("aria-describedby");
    expect(idAyuda).toBeTruthy();
    expect(document.getElementById(idAyuda!)?.textContent).toMatch(
      /SKU codificados/i,
    );
  });

  it("afinar por categoría viaja en la publicación", () => {
    montar();
    fireEvent.change(screen.getByDisplayValue("Todas las categorías"), {
      target: { value: CATEGORIA.id },
    });
    fireEvent.click(screen.getByRole("button", { name: /publicar versión/i }));

    return waitFor(() =>
      expect(publicar).toHaveBeenCalledWith(
        expect.objectContaining({ categoria_id: CATEGORIA.id }),
      ),
    );
  });

  it("en modo lectura no se puede publicar ni editar", () => {
    montar(true);
    expect(
      screen.queryByRole("button", { name: /publicar versión/i }),
    ).toBeNull();
    // Lo que deshabilita los campos es el `fieldset` que los envuelve, que es el
    // mecanismo de HTML para esto. Se afirma sobre él y no sobre `input.disabled`
    // porque jsdom no propaga esa herencia a la propiedad (los navegadores sí),
    // y un test que mirara el input pasaría en verde con el fieldset quitado.
    const fieldset = screen.getByDisplayValue("30").closest("fieldset");
    expect(fieldset?.hasAttribute("disabled")).toBe(true);
  });

  it("la vista previa se puede pedir también en modo lectura", () => {
    // El supervisor no publica, pero sí necesita entender el efecto de la
    // configuración vigente.
    montar(true);
    expect(screen.getByRole("button", { name: /ver efecto/i })).toBeTruthy();
  });
});
