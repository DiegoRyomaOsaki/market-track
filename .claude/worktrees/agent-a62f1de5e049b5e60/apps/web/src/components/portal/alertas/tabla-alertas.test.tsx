import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TablaAlertas, type FilaAlerta } from "./tabla-alertas";

const BASE: FilaAlerta = {
  id: "a0000016-0000-0000-0000-000000000001",
  tipo: "quiebre",
  severidad: "alta",
  estado: "nueva",
  creado_at: "2026-08-05T14:00:00.000Z",
  tienda_nombre: "Plaza Vea Surco",
  marca_nombre: "Oster",
  sku_codigo: "MRC-001",
  sku_nombre: "Néctar 1L",
};

function pintar(alertas: FilaAlerta[] = [BASE], querystring = "") {
  return render(<TablaAlertas alertas={alertas} querystring={querystring} />);
}

describe("TablaAlertas", () => {
  it("enseña el tipo con su nombre, no con el valor del enum", () => {
    pintar([{ ...BASE, tipo: "diferencia_stock" }]);
    expect(screen.getByText("Diferencia de stock")).toBeInTheDocument();
    expect(screen.queryByText("diferencia_stock")).not.toBeInTheDocument();
  });

  it("la severidad y el estado llevan TEXTO, no solo color", () => {
    // Una pastilla que solo tiñe no le dice nada a quien no distingue el color.
    pintar();
    expect(screen.getByText("Alta")).toBeInTheDocument();
    expect(screen.getByText("Nueva")).toBeInTheDocument();
  });

  it("cada fila enlaza a su detalle", () => {
    pintar();
    expect(screen.getByRole("link", { name: /Quiebre/ })).toHaveAttribute(
      "href",
      `/cliente/alertas/${BASE.id}`,
    );
  });

  it("el enlace CONSERVA los filtros: volver no puede perder la búsqueda", () => {
    pintar([BASE], "?estado=nueva&desde=2026-08-01");
    expect(screen.getByRole("link", { name: /Quiebre/ })).toHaveAttribute(
      "href",
      `/cliente/alertas/${BASE.id}?estado=nueva&desde=2026-08-01`,
    );
  });

  it("una alerta sin marca, tienda ni SKU se pinta con «—», no en blanco", () => {
    // La contingencia de una visita no cuelga de ninguna marca: es un hueco
    // legítimo, no un dato que falte por error.
    pintar([
      {
        ...BASE,
        tipo: "contingencia",
        marca_nombre: null,
        tienda_nombre: null,
        sku_codigo: null,
        sku_nombre: null,
      },
    ]);
    const fila = screen.getAllByRole("row")[1]!;
    expect(within(fila).getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("sin alertas lo dice, en vez de enseñar una tabla vacía", () => {
    pintar([]);
    expect(
      screen.getByText(/No hay alertas con estos filtros/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("la hora es la de Lima, que es donde se detectó", () => {
    // 14:00 UTC son las 09:00 en Lima. Con la zona del servidor, el cliente
    // leería una hora en la que su mercaderista no estaba en tienda.
    pintar();
    expect(screen.getByText(/09:00/)).toBeInTheDocument();
  });
});
