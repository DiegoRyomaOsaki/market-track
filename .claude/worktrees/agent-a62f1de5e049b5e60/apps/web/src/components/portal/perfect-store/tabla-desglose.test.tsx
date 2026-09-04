import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { FilaDesglose } from "@/lib/portal/perfect-store";

import { TablaDesglose } from "./tabla-desglose";

const FILA: FilaDesglose = {
  clave: "a0000004-0000-0000-0000-000000000001",
  etiqueta: "Bebidas",
  levantamientos: 4,
  total_pct: 72.5,
  distribucion_pct: 80,
  visibilidad_pct: 60,
  precio_pct: 90,
};

function pintar(filas: FilaDesglose[]) {
  return render(
    <TablaDesglose
      nivel="categoria"
      filas={filas}
      hrefDeFila={(clave) => `/cliente/perfect-store?categoria=${clave}`}
    />,
  );
}

describe("TablaDesglose", () => {
  it("sin filas lo dice, no pinta una tabla vacía", () => {
    pintar([]);
    expect(
      screen.getByText(/No hay levantamientos puntuados/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("cada grupo es un enlace que baja un nivel", () => {
    pintar([FILA]);
    expect(screen.getByRole("link", { name: "Bebidas" })).toHaveAttribute(
      "href",
      `/cliente/perfect-store?categoria=${FILA.clave}`,
    );
  });

  it("una variable sin datos se lee como tal, nunca como 0 %", () => {
    // La renormalización existe justo para esto: lo no evaluado no puntúa cero.
    pintar([{ ...FILA, visibilidad_pct: null }]);
    expect(screen.getByText("Sin datos")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("un grupo sin clave se muestra pero no es navegable", () => {
    // Esconderlo haría que el desglose no sumara el puntaje de arriba.
    pintar([{ ...FILA, clave: null, etiqueta: "Sin clasificar" }]);
    expect(screen.getByText("Sin clasificar")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("el encabezado nombra el nivel que se está desglosando", () => {
    pintar([FILA]);
    expect(
      screen.getByRole("columnheader", { name: "Categoría" }),
    ).toBeInTheDocument();
  });
});
