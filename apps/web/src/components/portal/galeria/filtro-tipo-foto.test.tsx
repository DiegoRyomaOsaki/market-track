import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FiltroTipoFoto } from "./filtro-tipo-foto";

const { replace, push, params } = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  params: { actual: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/cliente/galeria",
  useSearchParams: () => params.actual,
}));

function elegir(valor: string) {
  fireEvent.change(screen.getByLabelText(/Tipo de foto/), {
    target: { value: valor },
  });
}

beforeEach(() => {
  replace.mockReset();
  push.mockReset();
  params.actual = new URLSearchParams();
});

describe("FiltroTipoFoto", () => {
  it("no ofrece la selfie: es la cara del mercaderista, no evidencia de tienda", () => {
    render(<FiltroTipoFoto valor={null} />);
    expect(
      screen.queryByRole("option", { name: /Selfie/ }),
    ).not.toBeInTheDocument();
  });

  it("elegir un tipo lo pone en la URL", () => {
    render(<FiltroTipoFoto valor={null} />);
    elegir("antes");
    expect(String(replace.mock.calls[0]?.[0])).toContain("tipo=antes");
  });

  it("volver a «Todas» QUITA el parámetro, no lo deja vacío", () => {
    // `tipo=` sobreviviría en el enlace compartido y el lector de filtros
    // tendría que tratar la cadena vacía como "sin filtro".
    params.actual = new URLSearchParams("tipo=antes");
    render(<FiltroTipoFoto valor="antes" />);
    elegir("");
    expect(String(replace.mock.calls[0]?.[0])).not.toContain("tipo");
  });

  it("conserva los demás filtros de la URL", () => {
    params.actual = new URLSearchParams("desde=2026-07-01&tienda=t1");
    render(<FiltroTipoFoto valor={null} />);
    elegir("despues");
    const url = String(replace.mock.calls[0]?.[0]);
    expect(url).toContain("desde=2026-07-01");
    expect(url).toContain("tienda=t1");
  });

  it("navega con `replace`, nunca con `push`", () => {
    // Un `<select>` cerrado emite `change` en cada flecha del teclado: con
    // `push`, recorrer la lista dejaría un rastro que "atrás" deshace uno a uno.
    render(<FiltroTipoFoto valor={null} />);
    elegir("precio");
    expect(replace).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
