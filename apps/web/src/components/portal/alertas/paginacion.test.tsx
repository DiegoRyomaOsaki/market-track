import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Paginacion } from "./paginacion";

function pintar(
  props: Partial<Parameters<typeof Paginacion>[0]> = {},
  query = "",
) {
  return render(
    <Paginacion
      pagina={1}
      porPagina={50}
      total={324}
      params={new URLSearchParams(query)}
      {...props}
    />,
  );
}

describe("Paginacion", () => {
  it("dice qué tramo se está viendo del total", () => {
    pintar({ pagina: 2 });
    expect(screen.getByText("51–100 de 324")).toBeInTheDocument();
  });

  it("la última página no promete más de lo que hay", () => {
    pintar({ pagina: 7 });
    expect(screen.getByText("301–324 de 324")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Siguiente" }),
    ).not.toBeInTheDocument();
  });

  it("la primera no ofrece «Anterior»", () => {
    pintar();
    expect(
      screen.queryByRole("link", { name: "Anterior" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Siguiente" })).toBeInTheDocument();
  });

  it("con una sola página no se pinta: no hay nada que paginar", () => {
    const { container } = pintar({ total: 12 });
    expect(container).toBeEmptyDOMElement();
  });

  it("navega con enlaces reales, no con botones", () => {
    // Un enlace lo prefetchea Next y se puede abrir en otra pestaña.
    pintar({ pagina: 2 });
    expect(screen.getByRole("link", { name: "Siguiente" })).toHaveAttribute(
      "href",
      "?pagina=3",
    );
  });

  it("conserva los filtros al cambiar de página", () => {
    pintar({ pagina: 2 }, "estado=nueva&desde=2026-08-01");
    const url = screen
      .getByRole("link", { name: "Siguiente" })
      .getAttribute("href");
    expect(url).toContain("estado=nueva");
    expect(url).toContain("desde=2026-08-01");
  });

  it("volver a la primera no deja `pagina=1` colgando en la URL", () => {
    // Es el estado por defecto: dos URLs distintas para la misma vista.
    pintar({ pagina: 2 });
    expect(screen.getByRole("link", { name: "Anterior" })).toHaveAttribute(
      "href",
      "?",
    );
  });

  it("se anuncia como navegación para un lector de pantalla", () => {
    pintar({ pagina: 2 });
    expect(
      screen.getByRole("navigation", { name: "Paginación de alertas" }),
    ).toBeInTheDocument();
  });
});
