import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Reporte } from "@/lib/portal/reportes";

import { VistaPrevia } from "./vista-previa";

const PERIODO = { desde: "2026-08-01", hasta: "2026-08-26" };
const SIN_FILTROS = { desde: null, hasta: null, cadena: null, tienda: null };

function reporte(filas: Reporte["filas"] = []): Reporte {
  return { periodo: PERIODO, filas };
}

const UNA_FILA: Reporte["filas"] = [
  {
    clave: "sos",
    indicador: "Share of Shelf",
    valor: "38%",
    variacion: "+2 (sube)",
  },
];

describe("VistaPrevia", () => {
  it("la cabecera dice de quién es y de qué periodo", () => {
    // El navegador solo imprime la URL y la fecha si el usuario lo deja
    // activado: el periodo tiene que estar DENTRO del artefacto o el PDF no
    // dice de qué habla.
    render(
      <VistaPrevia
        reporte={reporte(UNA_FILA)}
        filtros={SIN_FILTROS}
        cliente="Maracumango"
        generadoEl="2026-08-26"
      />,
    );

    expect(screen.getByText(/Reporte de Maracumango/)).toBeTruthy();
    expect(screen.getByText(/2026-08-01/)).toBeTruthy();
    expect(screen.getByText(/Generado el 2026-08-26/)).toBeTruthy();
  });

  it("dice cuándo está filtrado, porque el PDF tiene que poder comprobarse", () => {
    render(
      <VistaPrevia
        reporte={reporte(UNA_FILA)}
        filtros={{ ...SIN_FILTROS, cadena: "c1" }}
        cliente="Maracumango"
        generadoEl="2026-08-26"
      />,
    );
    expect(screen.getByText(/Filtrado por una cadena/)).toBeTruthy();
  });

  it("la variación se lee en palabras, no solo por color", () => {
    render(
      <VistaPrevia
        reporte={reporte(UNA_FILA)}
        filtros={SIN_FILTROS}
        cliente="Maracumango"
        generadoEl="2026-08-26"
      />,
    );
    expect(screen.getByText("+2 (sube)")).toBeTruthy();
  });

  it("sin datos lo dice con el periodo, no deja la pantalla en blanco", () => {
    render(
      <VistaPrevia
        reporte={reporte([])}
        filtros={SIN_FILTROS}
        cliente="Maracumango"
        generadoEl="2026-08-26"
      />,
    );
    expect(screen.getByText(/Sin datos en el periodo/)).toBeTruthy();
  });
});
