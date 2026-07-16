import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SeccionPlaceholder } from "./seccion-placeholder";

// Canario del toolchain jsdom + Testing Library.
describe("SeccionPlaceholder", () => {
  it("muestra el título de la sección", () => {
    render(<SeccionPlaceholder titulo="Catálogo" />);
    expect(screen.getByText("Catálogo")).toBeInTheDocument();
    expect(
      screen.getByText(/todavía no está implementada/i),
    ).toBeInTheDocument();
  });
});
