import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCerrarAlSalir } from "./use-cerrar";

function conElemento() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return { ref: { current: el }, el };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useCerrarAlSalir", () => {
  it("cierra al hacer clic fuera del elemento", () => {
    const { ref } = conElemento();
    const cerrar = vi.fn();
    renderHook(() => useCerrarAlSalir(ref, true, cerrar));
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(cerrar).toHaveBeenCalledOnce();
  });

  it("NO cierra al hacer clic dentro del elemento", () => {
    const { ref, el } = conElemento();
    const cerrar = vi.fn();
    renderHook(() => useCerrarAlSalir(ref, true, cerrar));
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(cerrar).not.toHaveBeenCalled();
  });

  it("cierra al pulsar Escape", () => {
    const { ref } = conElemento();
    const cerrar = vi.fn();
    renderHook(() => useCerrarAlSalir(ref, true, cerrar));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(cerrar).toHaveBeenCalledOnce();
  });

  it("no escucha si está cerrado, y limpia los listeners al desmontar", () => {
    const { ref } = conElemento();
    const cerrar = vi.fn();
    // Cerrado: no reacciona.
    const cerrado = renderHook(() => useCerrarAlSalir(ref, false, cerrar));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(cerrar).not.toHaveBeenCalled();
    cerrado.unmount();

    // Abierto y luego desmontado: el listener queda desuscrito.
    const quitar = vi.spyOn(document, "removeEventListener");
    const abierto = renderHook(() => useCerrarAlSalir(ref, true, cerrar));
    abierto.unmount();
    expect(quitar).toHaveBeenCalledWith("mousedown", expect.any(Function));
    expect(quitar).toHaveBeenCalledWith("keydown", expect.any(Function));
    quitar.mockRestore();
  });
});
