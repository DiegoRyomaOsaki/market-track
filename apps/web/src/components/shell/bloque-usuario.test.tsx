import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BloqueUsuario } from "./bloque-usuario";

// La acción de verdad toca cookies y redirige: aquí solo importa que el bloque
// ofrezca un control real, no lo que la acción haga (eso vive en su propio test).
vi.mock("@/lib/sesion/acciones", () => ({ cerrarSesion: vi.fn() }));

describe("BloqueUsuario", () => {
  it("el control de salida es un BOTÓN con nombre accesible", () => {
    // El bloque era un `div` sin nada interactivo: no había forma de salir. Y si
    // alguien lo degrada a un `div` con `onClick`, deja de ser alcanzable con
    // teclado — este test es lo que lo caza.
    render(<BloqueUsuario nombre="Ana Torres" detalle="Supervisor" />);
    expect(
      screen.getByRole("button", { name: /cerrar sesión/i }),
    ).toBeInTheDocument();
  });

  it("pinta iniciales, nombre y el detalle que recibe", () => {
    render(<BloqueUsuario nombre="Ana Torres" detalle="Supervisor" />);
    expect(screen.getByText("AT")).toBeInTheDocument();
    expect(screen.getByText("Ana Torres")).toBeInTheDocument();
    expect(screen.getByText("Supervisor")).toBeInTheDocument();
  });

  it("el detalle es el mismo hueco para el rol del panel y el cliente del portal", () => {
    // Es lo que permite que haya UN bloque en vez de dos: la única diferencia
    // entre las dos copias era esta línea.
    render(<BloqueUsuario nombre="Brand Manager" detalle="Oster Perú" />);
    expect(screen.getByText("Oster Perú")).toBeInTheDocument();
  });

  it("el nombre de un cliente-marca se pinta TAL CUAL, sin capitalizar", () => {
    // El bloque del panel usaba `capitalize` para el rol. Compartido con el
    // portal, esa clase deformaría una marca escrita a propósito en minúscula.
    render(<BloqueUsuario nombre="Ana Torres" detalle="iShop Perú" />);
    const detalle = screen.getByText("iShop Perú");
    expect(detalle.className).not.toContain("capitalize");
  });
});
