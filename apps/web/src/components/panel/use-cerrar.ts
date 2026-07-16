"use client";

import { type RefObject, useEffect } from "react";

/** Cierra un popover al hacer clic fuera o pulsar Escape. */
export function useCerrarAlSalir(
  ref: RefObject<HTMLElement | null>,
  abierto: boolean,
  cerrar: () => void,
): void {
  useEffect(() => {
    if (!abierto) return;
    const alClic = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cerrar();
    };
    const alTecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar();
    };
    document.addEventListener("mousedown", alClic);
    document.addEventListener("keydown", alTecla);
    return () => {
      document.removeEventListener("mousedown", alClic);
      document.removeEventListener("keydown", alTecla);
    };
  }, [ref, abierto, cerrar]);
}
