import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BarraSerie } from "@/lib/portal/perfect-store";

import { GraficaEvolucion } from "./grafica-evolucion";

const CON_DATOS: BarraSerie = {
  periodo: "2026-08-03",
  etiqueta: "03 ago",
  valor: 72,
  levantamientos: 4,
  altura: 0.72,
};

const VACIO: BarraSerie = {
  periodo: "2026-08-10",
  etiqueta: "10 ago",
  valor: null,
  levantamientos: 0,
  altura: 0,
};

function pintar(barras: BarraSerie[]) {
  return render(
    <GraficaEvolucion
      barras={barras}
      granularidad="semana"
      hrefDeGranularidad={(g) => `/cliente/perfect-store?granularidad=${g}`}
    />,
  );
}

describe("GraficaEvolucion", () => {
  it("los mismos números están en texto, no solo en la altura de las barras", () => {
    // WCAG 1.4.1: el alto de una barra es forma, no un dato legible.
    pintar([CON_DATOS, VACIO]);
    const tabla = screen.getByRole("table");
    expect(within(tabla).getByText("72%")).toBeInTheDocument();
  });

  it("un periodo sin visitas se lee como sin datos, no como cero", () => {
    pintar([CON_DATOS, VACIO]);
    const tabla = screen.getByRole("table");
    expect(within(tabla).getByText("Sin datos")).toBeInTheDocument();
    expect(within(tabla).queryByText("0%")).not.toBeInTheDocument();
  });

  it("cuando ningún periodo tiene datos lo dice", () => {
    pintar([VACIO, { ...VACIO, periodo: "2026-08-17" }]);
    expect(
      screen.getByText(/Ningún periodo del rango tiene visitas puntuadas/),
    ).toBeInTheDocument();
  });

  it("sin periodos que mostrar avisa en vez de dibujar un marco vacío", () => {
    pintar([]);
    expect(screen.getByText(/No hay periodos que mostrar/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("la granularidad activa se marca para quien no ve el resalte", () => {
    pintar([CON_DATOS]);
    expect(screen.getByRole("link", { name: "Semana" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Mes" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});
