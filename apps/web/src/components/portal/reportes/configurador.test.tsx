import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Configurador } from "./configurador";

const FILTROS = {
  desde: "2026-08-01",
  hasta: "2026-08-26",
  cadena: "a0000002-0000-0000-0000-000000000001",
  tienda: null,
};

describe("Configurador", () => {
  it("ofrece los seis indicadores", () => {
    render(<Configurador filtros={FILTROS} seleccion={null} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(6);
  });

  it("sin selección vienen todos marcados", () => {
    render(<Configurador filtros={FILTROS} seleccion={null} />);
    for (const c of screen.getAllByRole<HTMLInputElement>("checkbox")) {
      expect(c.checked).toBe(true);
    }
  });

  it("con selección solo esos vienen marcados", () => {
    render(<Configurador filtros={FILTROS} seleccion={["sos"]} />);
    const marcados = screen
      .getAllByRole<HTMLInputElement>("checkbox")
      .filter((c) => c.checked);

    expect(marcados).toHaveLength(1);
    expect(marcados[0]?.value).toBe("sos");
  });

  it("arrastra los filtros globales en campos ocultos", () => {
    // Sin esto, enviar el formulario los borraría de la URL: la vista previa
    // cambiaría de periodo al tocar un indicador y se exportaría algo distinto
    // de lo que se vio.
    const { container } = render(
      <Configurador filtros={FILTROS} seleccion={null} />,
    );
    const ocultos = [
      ...container.querySelectorAll<HTMLInputElement>('input[type="hidden"]'),
    ];

    expect(Object.fromEntries(ocultos.map((o) => [o.name, o.value]))).toEqual({
      desde: "2026-08-01",
      hasta: "2026-08-26",
      cadena: "a0000002-0000-0000-0000-000000000001",
    });
  });

  it("un filtro que no está puesto no viaja vacío", () => {
    // Un `tienda=` vacío en la URL no es lo mismo que no filtrar por tienda.
    const { container } = render(
      <Configurador filtros={FILTROS} seleccion={null} />,
    );
    expect(container.querySelector('input[name="tienda"]')).toBeNull();
  });

  it("es un formulario GET: el estado sigue viviendo en la URL", () => {
    const { container } = render(
      <Configurador filtros={FILTROS} seleccion={null} />,
    );
    expect(container.querySelector("form")?.getAttribute("method")).toBe("get");
  });
});
