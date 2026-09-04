import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FiltrosAlertas } from "./filtros-alertas";

const { push, params } = vi.hoisted(() => ({
  push: vi.fn(),
  params: { actual: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/cliente/alertas",
  useSearchParams: () => params.actual,
}));

const VACIO = { tipo: null, severidad: null, estado: null };

function aplicar() {
  fireEvent.submit(
    screen.getByRole("button", { name: "Aplicar" }).closest("form")!,
  );
}

function urlAplicada(): string {
  return String(push.mock.calls[0]?.[0]);
}

beforeEach(() => {
  push.mockReset();
  params.actual = new URLSearchParams();
});

describe("FiltrosAlertas", () => {
  it("cada filtro tiene su etiqueta asociada", () => {
    render(<FiltrosAlertas valores={VACIO} />);
    expect(screen.getByLabelText("Tipo")).toBeInTheDocument();
    expect(screen.getByLabelText("Severidad")).toBeInTheDocument();
    expect(screen.getByLabelText("Estado")).toBeInTheDocument();
  });

  it("ofrece los seis tipos de alerta por su nombre", () => {
    render(<FiltrosAlertas valores={VACIO} />);
    const tipo = screen.getByLabelText("Tipo");
    expect(within(tipo).getAllByRole("option")).toHaveLength(7); // 6 + "Todas"
    expect(
      screen.getByRole("option", { name: "Exhibición incompleta" }),
    ).toBeInTheDocument();
  });

  it("aplicar escribe los filtros elegidos en la URL", () => {
    render(<FiltrosAlertas valores={VACIO} />);
    fireEvent.change(screen.getByLabelText("Tipo"), {
      target: { value: "contingencia" },
    });
    aplicar();
    expect(urlAplicada()).toContain("tipo=contingencia");
  });

  it("aplicar CONSERVA los filtros globales de la misma URL", () => {
    // Fechas, cadena y tienda son de la barra global: borrarlas al filtrar por
    // severidad sería deshacer lo que el cliente ya había acotado.
    params.actual = new URLSearchParams("desde=2026-08-01&tienda=t1");
    render(<FiltrosAlertas valores={VACIO} />);
    fireEvent.change(screen.getByLabelText("Severidad"), {
      target: { value: "critica" },
    });
    aplicar();

    const url = urlAplicada();
    expect(url).toContain("desde=2026-08-01");
    expect(url).toContain("tienda=t1");
    expect(url).toContain("severidad=critica");
  });

  it("cambiar de filtro vuelve a la primera página", () => {
    // La página 5 del resultado anterior puede no existir en el nuevo, y el
    // cliente vería una pantalla vacía creyendo que no hay alertas.
    params.actual = new URLSearchParams("pagina=5");
    render(<FiltrosAlertas valores={VACIO} />);
    fireEvent.change(screen.getByLabelText("Estado"), {
      target: { value: "resuelta" },
    });
    aplicar();
    expect(urlAplicada()).not.toContain("pagina");
  });

  it("volver a «Todas» QUITA el parámetro, no lo deja vacío", () => {
    params.actual = new URLSearchParams("tipo=quiebre");
    render(<FiltrosAlertas valores={{ ...VACIO, tipo: "quiebre" }} />);
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "" } });
    aplicar();
    expect(urlAplicada()).not.toContain("tipo");
  });

  it("limpiar borra los de la bandeja y respeta los globales", () => {
    params.actual = new URLSearchParams(
      "tipo=quiebre&estado=nueva&desde=2026-08-01",
    );
    render(<FiltrosAlertas valores={{ ...VACIO, tipo: "quiebre" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));

    const url = urlAplicada();
    expect(url).not.toContain("tipo");
    expect(url).not.toContain("estado");
    expect(url).toContain("desde=2026-08-01");
  });
});
