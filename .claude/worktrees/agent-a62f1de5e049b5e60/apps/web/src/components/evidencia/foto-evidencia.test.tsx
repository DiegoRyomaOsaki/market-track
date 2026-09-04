import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FotoEvidencia } from "./foto-evidencia";

const CAPTURA = "2026-08-03T14:00:00Z";

describe("FotoEvidencia", () => {
  it("sin URL, la evidencia sigue en el teléfono y lo dice", () => {
    // No hay objeto que firmar en R2 hasta que la cola de subida lo suba: pintar
    // una imagen rota sería mentir sobre por qué no se ve.
    render(
      <FotoEvidencia url={undefined} etiqueta="Antes" capturadaAt={CAPTURA} />,
    );
    expect(screen.getByText(/Pendiente de subida/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("con URL pinta la foto con un alt que dice qué es y cuándo se tomó", () => {
    render(
      <FotoEvidencia
        url="https://r2/x"
        etiqueta="Después"
        capturadaAt={CAPTURA}
      />,
    );
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://r2/x");
    expect(img.getAttribute("alt")).toMatch(/^Después, capturada el /);
  });

  it("si el enlace caducó lo explica en vez de dejar un icono roto", () => {
    // Las URLs firmadas viven minutos: con la pestaña abierta, R2 responde 403.
    render(
      <FotoEvidencia
        url="https://r2/x"
        etiqueta="Antes"
        capturadaAt={CAPTURA}
      />,
    );

    fireEvent.error(screen.getByRole("img"));

    expect(screen.getByText(/caducó/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("la etiqueta se lee siempre, haya foto o no", () => {
    render(
      <FotoEvidencia url={undefined} etiqueta="Antes" capturadaAt={CAPTURA} />,
    );
    expect(screen.getByText("Antes")).toBeInTheDocument();
  });

  it("mientras llegan los bytes lo anuncia, no solo lo anima", () => {
    // El ticket pide modelar el estado "cargando". Una animación sola no se lo
    // dice a quien usa lector de pantalla.
    render(
      <FotoEvidencia
        url="https://r2/x"
        etiqueta="Antes"
        capturadaAt={CAPTURA}
      />,
    );
    expect(screen.getByRole("figure")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Cargando imagen")).toBeInTheDocument();
  });

  it("al cargar deja de anunciarlo", () => {
    render(
      <FotoEvidencia
        url="https://r2/x"
        etiqueta="Antes"
        capturadaAt={CAPTURA}
      />,
    );

    fireEvent.load(screen.getByRole("img"));

    expect(screen.getByRole("figure")).toHaveAttribute("aria-busy", "false");
    expect(screen.queryByText("Cargando imagen")).not.toBeInTheDocument();
  });

  it("una imagen YA cacheada no se queda cargando para siempre", () => {
    // El navegador puede completarla antes de que React enganche el `onLoad`:
    // sin la comprobación de `complete`, el esqueleto tapa una foto que ya está.
    Object.defineProperty(HTMLImageElement.prototype, "complete", {
      configurable: true,
      get: () => true,
    });

    render(
      <FotoEvidencia
        url="https://r2/x"
        etiqueta="Antes"
        capturadaAt={CAPTURA}
      />,
    );

    expect(screen.getByRole("figure")).toHaveAttribute("aria-busy", "false");
    Reflect.deleteProperty(HTMLImageElement.prototype, "complete");
  });

  it("una foto sin subir no anuncia carga: no hay nada en camino", () => {
    render(
      <FotoEvidencia url={undefined} etiqueta="Antes" capturadaAt={CAPTURA} />,
    );
    expect(screen.getByRole("figure")).toHaveAttribute("aria-busy", "false");
  });
});
