import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ComparadorAntesDespues } from "./comparador-antes-despues";

const CAPTURA = "2026-08-05T14:00:00.000Z";
const antes = { id: "a", capturada_at: CAPTURA, subida_at: CAPTURA };
const despues = { id: "d", capturada_at: CAPTURA, subida_at: CAPTURA };
const URLS = { a: "https://r2/a", d: "https://r2/d" };

function pintar(
  props: Partial<Parameters<typeof ComparadorAntesDespues>[0]> = {},
) {
  return render(
    <ComparadorAntesDespues
      antes={antes}
      despues={despues}
      urls={URLS}
      rotulo="Oster, 5 ago"
      {...props}
    />,
  );
}

describe("ComparadorAntesDespues", () => {
  it("con las dos, las pinta lado a lado y rotuladas", () => {
    pintar();
    expect(screen.getByText("Antes")).toBeInTheDocument();
    expect(screen.getByText("Después")).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });

  it("el grupo dice de qué marca y visita es, para un lector de pantalla", () => {
    pintar();
    expect(
      screen.getByRole("group", { name: /Antes y después — Oster/ }),
    ).toBeInTheDocument();
  });

  it("si falta el Después dice que NO SE REGISTRÓ, no que esté pendiente", () => {
    // Son dos hechos distintos: uno es que el mercaderista no la tomó, el otro
    // que la tomó y sigue en su teléfono. Decirlos igual sería mentir.
    pintar({ despues: null });
    expect(screen.getByText(/no registró esta foto/)).toBeInTheDocument();
    expect(screen.queryByText(/Pendiente de subida/)).not.toBeInTheDocument();
  });

  it("una foto sin subir SÍ dice que está pendiente", () => {
    pintar({ despues: { ...despues, subida_at: null } });
    expect(screen.getByText(/Pendiente de subida/)).toBeInTheDocument();
    expect(screen.queryByText(/no registró/)).not.toBeInTheDocument();
  });

  it("sin ninguna de las dos, un solo aviso en vez de dos cajas vacías", () => {
    pintar({ antes: null, despues: null });
    expect(screen.getByText(/Sin evidencia fotográfica/)).toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("una foto subida cuya URL no llegó se trata como pendiente de firma", () => {
    // El firmador falló: la página avisa aparte con `degradado`; aquí no se
    // inventa una imagen rota.
    pintar({ urls: {} });
    expect(screen.getAllByText(/Pendiente de subida/)).toHaveLength(2);
  });
});
