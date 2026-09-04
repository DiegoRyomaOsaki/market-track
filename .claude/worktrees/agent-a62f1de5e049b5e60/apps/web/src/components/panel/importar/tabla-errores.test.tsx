import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TablaErrores } from "./tabla-errores";

// Lo que se prueba aquí son las celdas que NO traen valor. Un error de cabecera
// no tiene columna concreta y una celda en blanco no tiene valor: pintarlos como
// huecos vacíos deja al operador sin saber si falta el dato o falta la columna.

const ERROR_DE_CELDA = {
  hoja: "tienda",
  fila: 14,
  columna: "cadena_codigo_externo",
  valor: "CAD-99",
  mensaje: "La cadena CAD-99 no existe",
};

describe("TablaErrores", () => {
  it("pinta hoja, fila del Excel, columna, valor y motivo", () => {
    render(<TablaErrores errores={[ERROR_DE_CELDA]} omitidos={0} />);

    expect(screen.getByText("tienda")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("cadena_codigo_externo")).toBeInTheDocument();
    expect(screen.getByText("CAD-99")).toBeInTheDocument();
    expect(screen.getByText(/La cadena CAD-99 no existe/)).toBeInTheDocument();
  });

  it("un error sin columna concreta no deja la celda en blanco", () => {
    render(
      <TablaErrores
        errores={[{ ...ERROR_DE_CELDA, columna: null }]}
        omitidos={0}
      />,
    );

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("una celda vacía se dice, no se deja adivinar", () => {
    render(
      <TablaErrores
        errores={[{ ...ERROR_DE_CELDA, valor: "" }]}
        omitidos={0}
      />,
    );

    expect(screen.getByText("(vacío)")).toBeInTheDocument();
  });

  it("sin errores omitidos no habla de los que faltan", () => {
    render(<TablaErrores errores={[ERROR_DE_CELDA]} omitidos={0} />);

    expect(screen.queryByText(/no se muestran/)).toBeNull();
  });

  it("un solo error omitido va en singular", () => {
    render(<TablaErrores errores={[ERROR_DE_CELDA]} omitidos={1} />);

    expect(screen.getByText(/1 error más/)).toBeInTheDocument();
  });
});
