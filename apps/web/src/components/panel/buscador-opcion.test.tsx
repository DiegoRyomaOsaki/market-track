import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BuscadorOpcion, type OpcionBusqueda } from "./buscador-opcion";

// El buscador sustituye a un <select> en formularios que envían por FormData:
// lo que se fija aquí es que el input oculto lleve EXACTAMENTE lo elegido — un
// id que se queda tras borrar el texto, o que nunca se pone, guarda otra cosa
// que lo que el operador ve.

const OPCION: OpcionBusqueda = {
  id: "s-mrc",
  etiqueta: "MRC-001 · Néctar 1L",
  tenant_id: "aaaaaaaa-0000-0000-0000-000000000001",
};

const buscar = vi.fn();

function pintar(props: Partial<Parameters<typeof BuscadorOpcion>[0]> = {}) {
  return render(
    <BuscadorOpcion
      etiqueta="SKU"
      nombreCampo="sku_id"
      buscar={buscar}
      tenantId={OPCION.tenant_id}
      {...props}
    />,
  );
}

function idOculto(container: HTMLElement): string {
  const oculto = container.querySelector<HTMLInputElement>(
    'input[name="sku_id"]',
  );
  return oculto?.value ?? "";
}

function escribir(texto: string) {
  fireEvent.change(screen.getByRole("combobox", { name: "SKU" }), {
    target: { value: texto },
  });
}

beforeEach(() => {
  buscar.mockReset();
  buscar.mockResolvedValue({ ok: true, opciones: [OPCION] });
});

describe("BuscadorOpcion", () => {
  it("busca lo tecleado y ofrece los resultados", async () => {
    pintar();
    escribir("néctar");

    expect(
      await screen.findByRole("option", { name: OPCION.etiqueta }),
    ).toBeInTheDocument();
    expect(buscar).toHaveBeenCalledWith("néctar", OPCION.tenant_id);
  });

  it("elegir con el ratón pone el id en el campo oculto", async () => {
    const { container } = pintar();
    escribir("néctar");
    fireEvent.mouseDown(
      await screen.findByRole("option", { name: OPCION.etiqueta }),
    );

    expect(idOculto(container)).toBe("s-mrc");
    expect(screen.getByRole("combobox", { name: "SKU" })).toHaveValue(
      OPCION.etiqueta,
    );
  });

  it("se puede elegir SOLO con el teclado: flecha abajo y Enter", async () => {
    const { container } = pintar();
    escribir("néctar");
    await screen.findByRole("option", { name: OPCION.etiqueta });

    const input = screen.getByRole("combobox", { name: "SKU" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(idOculto(container)).toBe("s-mrc");
  });

  it("el Enter de la selección NO envía el formulario", async () => {
    const alEnviar = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={alEnviar}>
        <BuscadorOpcion
          etiqueta="SKU"
          nombreCampo="sku_id"
          buscar={buscar}
          tenantId={null}
        />
      </form>,
    );
    escribir("néctar");
    await screen.findByRole("option", { name: OPCION.etiqueta });

    const input = screen.getByRole("combobox", { name: "SKU" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(alEnviar).not.toHaveBeenCalled();
  });

  it("cambiar el texto tras elegir LIMPIA el id oculto", async () => {
    // Sin esto, el operador borra el SKU elegido, envía, y viaja el id viejo:
    // guarda otra cosa que lo que la pantalla enseña.
    const { container } = pintar();
    escribir("néctar");
    fireEvent.mouseDown(
      await screen.findByRole("option", { name: OPCION.etiqueta }),
    );
    escribir("otra cosa");

    expect(idOculto(container)).toBe("");
  });

  it("Escape cierra la lista sin elegir", async () => {
    const { container } = pintar();
    escribir("néctar");
    await screen.findByRole("option", { name: OPCION.etiqueta });

    fireEvent.keyDown(screen.getByRole("combobox", { name: "SKU" }), {
      key: "Escape",
    });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(idOculto(container)).toBe("");
  });

  it("sin resultados lo dice, también para el lector de pantalla", async () => {
    buscar.mockResolvedValue({ ok: true, opciones: [] });
    pintar();
    escribir("zzz");

    expect(await screen.findAllByText("Sin resultados")).not.toHaveLength(0);
  });

  it("un fallo de la búsqueda se enseña en vez de un spinner eterno", async () => {
    buscar.mockResolvedValue({
      ok: false,
      error: "No se pudo buscar. Reintenta.",
    });
    pintar();
    escribir("néctar");

    // Dos veces a propósito: la lista para quien mira y el aria-live para
    // quien escucha.
    expect(
      await screen.findAllByText("No se pudo buscar. Reintenta."),
    ).not.toHaveLength(0);
  });

  it("una promesa rechazada tampoco deja el buscador mudo", async () => {
    buscar.mockRejectedValue(new Error("network"));
    pintar();
    escribir("néctar");

    expect(
      await screen.findAllByText("No se pudo buscar. Reintenta."),
    ).not.toHaveLength(0);
  });

  it("el valor inicial (edición) llega puesto sin buscar nada", () => {
    const { container } = pintar({ valorInicial: OPCION });

    expect(idOculto(container)).toBe("s-mrc");
    expect(screen.getByRole("combobox", { name: "SKU" })).toHaveValue(
      OPCION.etiqueta,
    );
    expect(buscar).not.toHaveBeenCalled();
  });

  it("con limpiarAlElegir avisa al padre y deja el campo listo para otra", async () => {
    const alElegir = vi.fn();
    pintar({ alElegir, limpiarAlElegir: true, nombreCampo: undefined });
    escribir("néctar");
    fireEvent.mouseDown(
      await screen.findByRole("option", { name: OPCION.etiqueta }),
    );

    expect(alElegir).toHaveBeenCalledWith(OPCION);
    expect(screen.getByRole("combobox", { name: "SKU" })).toHaveValue("");
  });
});
