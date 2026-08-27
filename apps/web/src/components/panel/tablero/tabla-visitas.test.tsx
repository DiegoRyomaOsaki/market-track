import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { FilaTablero } from "@/lib/panel/tablero";

import { TablaVisitas } from "./tabla-visitas";

// `colorDeVisita`, `textoDeVisita` y `formatoDuracion` ya están probadas como
// funciones puras en `tablero.test.ts`. Lo que se comprueba aquí es que la tabla
// las PINTE: un badge que se quedara sin texto —o con el tono de otro estado—
// pasaría aquellas pruebas sin despeinarse.

function fila(over: Partial<FilaTablero> = {}): FilaTablero {
  return {
    visita_id: "v1",
    mercaderista_nombre: "Ana Quispe",
    mercaderista_dni: "12345678",
    tienda_id: "t1",
    tienda_nombre: "Plaza Vea Surco",
    tienda_lat: -12.08,
    tienda_lon: -76.94,
    check_in_at: "2026-08-03T14:30:00Z",
    check_out_at: null,
    duracion_min: 85,
    tiempo_traslado_min: 12,
    bateria_inicio_pct: 87,
    fotos: 4,
    estado: "en_curso",
    motivo: null,
    ...over,
  };
}

describe("TablaVisitas", () => {
  describe("el estado de cada visita", () => {
    // Los tres valores del enum, no uno de muestra: una tabla que solo supiera
    // pintar el estado que se probó dejaría los otros dos en blanco.
    const estados = [
      { estado: "completada", texto: "visita completada", tono: "completado" },
      { estado: "en_curso", texto: "visita en curso", tono: "en-curso" },
      { estado: "bloqueada", texto: "visita bloqueada", tono: "alerta" },
    ] as const;

    it.each(estados)(
      "«$estado» se LEE como «$texto», no solo se colorea (WCAG 1.4.1)",
      ({ estado, texto }) => {
        render(<TablaVisitas filas={[fila({ estado })]} />);

        // Por ROL, no por texto. `getByText` solo mira el DOM: encontraría la
        // pastilla igual aunque estuviera bajo un `aria-hidden`, y entonces este
        // test diría «se lee» de algo que ningún lector de pantalla anuncia. Las
        // consultas por rol sí pasan por `isInaccessible`. No es hipotético: el
        // `Avatar` de esta misma tabla es `aria-hidden`, así que la regresión
        // está a dos líneas de distancia.
        expect(screen.getByRole("cell", { name: texto })).toBeInTheDocument();
      },
    );

    it.each(estados)(
      "«$estado» además lleva su propio tono, no el de otro estado",
      ({ estado, texto, tono }) => {
        // El texto es lo que cumple la pauta de accesibilidad; el tono se fija
        // aparte para que cruzar dos estados —pintar «bloqueada» de verde— se
        // caiga aquí en vez de llegar al supervisor.
        render(<TablaVisitas filas={[fila({ estado })]} />);

        expect(screen.getByText(texto)).toHaveClass(
          `bg-${tono}-suave`,
          `text-${tono}-texto`,
        );
      },
    );

    it("cada visita trae su propio estado cuando conviven varias", () => {
      render(
        <TablaVisitas
          filas={[
            fila({ visita_id: "v1", estado: "completada" }),
            fila({ visita_id: "v2", estado: "bloqueada" }),
          ]}
        />,
      );

      expect(
        screen.getByRole("cell", { name: "visita completada" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("cell", { name: "visita bloqueada" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("cell", { name: "visita en curso" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("sin visitas", () => {
    it("lo dice, en vez de dejar una tabla con la cabecera sola", () => {
      render(<TablaVisitas filas={[]} />);

      expect(
        screen.getByText("Todavía no hay visitas registradas hoy."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });
  });

  describe("los campos derivados", () => {
    it("pinta la duración ya formateada, no los minutos crudos", () => {
      render(<TablaVisitas filas={[fila({ duracion_min: 85 })]} />);

      expect(screen.getByText("1 h 25 min")).toBeInTheDocument();
      expect(screen.queryByText("85")).not.toBeInTheDocument();
    });

    it("lo que la base no pudo calcular se pinta como raya, no como hueco", () => {
      // Son columnas distintas y todas caen a "—": se cuentan dentro de la fila
      // para no depender de cuántas rayas haya en el resto de la tabla.
      render(
        <TablaVisitas
          filas={[
            fila({
              mercaderista_dni: null,
              check_out_at: null,
              duracion_min: null,
              tiempo_traslado_min: null,
              bateria_inicio_pct: null,
              motivo: null,
            }),
          ]}
        />,
      );

      const celdas = within(screen.getByRole("row", { name: /Ana Quispe/ }))
        .getAllByRole("cell")
        .map((c) => c.textContent);

      expect(celdas.filter((t) => t === "—")).toHaveLength(6);
    });
  });
});
