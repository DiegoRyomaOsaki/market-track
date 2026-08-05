import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TiendaConEvidencia as Tienda } from "@market-track/shared";

import { TiendaConEvidencia } from "./tienda-con-evidencia";

const CAPTURA = "2026-08-05T14:00:00.000Z";

function foto(id: string, tipo = "antes", subida: string | null = CAPTURA) {
  return { id, tipo, capturada_at: CAPTURA, subida_at: subida };
}

function tienda(sobre: Partial<Tienda> = {}): Tienda {
  return {
    id: "t1",
    nombre: "Plaza Vea Surco",
    direccion: "Av. Primavera 123",
    cadena_nombre: "Plaza Vea",
    visitas: [
      {
        id: "v1",
        check_in_at: CAPTURA,
        check_out_at: null,
        fotos_visita: [],
        levantamientos: [
          {
            id: "l1",
            marca_nombre: "Oster",
            estado: "completado",
            sos_frentes_propios: 4,
            quiebres: 2,
            antes: foto("a"),
            despues: foto("d", "despues"),
            otras: [],
          },
        ],
      },
    ],
    ...sobre,
  };
}

const URLS = { a: "https://r2/a", d: "https://r2/d" };

function pintar(t: Tienda = tienda(), props = {}) {
  return render(<TiendaConEvidencia tienda={t} urls={URLS} {...props} />);
}

describe("TiendaConEvidencia", () => {
  it("agrupa por MARCA, no por tienda: cada góndola es un pasillo distinto", () => {
    const t = tienda();
    t.visitas[0]!.levantamientos.push({
      ...t.visitas[0]!.levantamientos[0]!,
      id: "l2",
      marca_nombre: "Sharpie",
    });
    pintar(t);

    expect(screen.getByText("Oster")).toBeInTheDocument();
    expect(screen.getByText("Sharpie")).toBeInTheDocument();
    expect(
      screen.getAllByRole("group", { name: /Antes y después/ }),
    ).toHaveLength(2);
  });

  it("enlaza al detalle de la tienda", () => {
    pintar();
    expect(
      screen.getByRole("link", { name: "Plaza Vea Surco" }),
    ).toHaveAttribute("href", "/cliente/tienda/t1");
  });

  it("en la propia página de la tienda no se enlaza a sí misma", () => {
    pintar(tienda(), { enlazarDetalle: false });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/Plaza Vea Surco/)).toBeInTheDocument();
  });

  it("avisa de las fotos que siguen en el teléfono, con su número", () => {
    const t = tienda();
    t.visitas[0]!.levantamientos[0]!.antes = foto("a", "antes", null);
    pintar(t);
    expect(screen.getByText("1 foto aún en el teléfono")).toBeInTheDocument();
  });

  it("sin fotos pendientes no inventa el aviso", () => {
    pintar();
    expect(screen.queryByText(/en el teléfono/)).not.toBeInTheDocument();
  });

  it("una visita sin levantamiento lo dice en vez de quedarse en blanco", () => {
    const t = tienda();
    t.visitas[0]!.levantamientos = [];
    pintar(t);
    expect(
      screen.getByText(/Sin levantamiento registrado/),
    ).toBeInTheDocument();
  });

  it("concuerda el singular y el plural de las visitas", () => {
    expect(screen.queryByText("2 visitas")).not.toBeInTheDocument();
    pintar();
    expect(screen.getByText("1 visita")).toBeInTheDocument();

    const t = tienda();
    t.visitas.push({ ...t.visitas[0]!, id: "v2" });
    pintar(t);
    expect(screen.getByText("2 visitas")).toBeInTheDocument();
  });
});
