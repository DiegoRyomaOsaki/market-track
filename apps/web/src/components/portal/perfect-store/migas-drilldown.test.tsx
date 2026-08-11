import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MigasDrilldown } from "./migas-drilldown";

const MIGAS = [
  { etiqueta: "Todo", href: "/cliente/perfect-store" },
  { etiqueta: "Bebidas", href: "/cliente/perfect-store?categoria=cat-1" },
  {
    etiqueta: "hiper",
    href: "/cliente/perfect-store?categoria=cat-1&tipotienda=hiper",
  },
];

describe("MigasDrilldown", () => {
  it("el nivel actual no es un enlace: ya se está en él", () => {
    render(<MigasDrilldown migas={MIGAS} />);
    expect(
      screen.queryByRole("link", { name: "hiper" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("hiper")).toHaveAttribute("aria-current", "page");
  });

  it("los niveles de arriba llevan de vuelta a su corte", () => {
    render(<MigasDrilldown migas={MIGAS} />);
    expect(screen.getByRole("link", { name: "Todo" })).toHaveAttribute(
      "href",
      "/cliente/perfect-store",
    );
    expect(screen.getByRole("link", { name: "Bebidas" })).toHaveAttribute(
      "href",
      "/cliente/perfect-store?categoria=cat-1",
    );
  });

  it("es una navegación con nombre, no una fila de enlaces sueltos", () => {
    render(<MigasDrilldown migas={MIGAS} />);
    expect(
      screen.getByRole("navigation", { name: "Nivel del desglose" }),
    ).toBeInTheDocument();
  });
});
