import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SaludoSesion } from "./saludo-sesion";

// Canario del toolchain jsdom + Testing Library (primer workspace con jsdom).
describe("SaludoSesion", () => {
  it("muestra el título y el email de la sesión", () => {
    render(
      <SaludoSesion
        titulo="Panel de administración"
        email="ana@market-track.pe"
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Panel de administración" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ana@market-track.pe")).toBeInTheDocument();
  });

  it("sin email muestra un guion", () => {
    render(<SaludoSesion titulo="Portal del cliente" email={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
