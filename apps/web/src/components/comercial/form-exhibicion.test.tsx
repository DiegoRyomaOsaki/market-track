import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FormExhibicion } from "./form-exhibicion";

// Lo que se prueba aquí es el aislamiento por cliente DENTRO del formulario.
//
// `exhibicion_negociada.sku_ids` es un `uuid[]` sin clave foránea: la base no
// comprueba de quién es cada elemento. Si al cambiar de tienda los SKUs marcados
// del cliente anterior se quedan en el estado, dejan de verse pero viajan igual
// en el envío — y se guardarían.

const { crear } = vi.hoisted(() => ({ crear: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/comercial/acciones", () => ({
  crearExhibicion: crear,
  editarExhibicion: vi.fn(),
}));

const MARACUMANGO = "aaaaaaaa-0000-0000-0000-000000000001";
const RIVAL = "bbbbbbbb-0000-0000-0000-000000000002";

const TIENDAS = [
  {
    id: "t-mrc",
    nombre: "Plaza Vea Angamos",
    tenant_id: MARACUMANGO,
    cliente: "Maracumango",
  },
  {
    id: "t-riv",
    nombre: "Tottus San Isidro",
    tenant_id: RIVAL,
    cliente: "Cliente Rival",
  },
];

const MARCAS = [
  { id: "m-mrc", nombre: "Maracumango", tenant_id: MARACUMANGO },
  { id: "m-riv", nombre: "Marca Rival", tenant_id: RIVAL },
];

const SKUS = [
  {
    id: "s-mrc",
    codigo: "MRC-001",
    nombre: "Néctar 1L",
    tenant_id: MARACUMANGO,
    cliente: "Maracumango",
  },
  {
    id: "s-riv",
    codigo: "RIV-001",
    nombre: "Bebida Rival 1L",
    tenant_id: RIVAL,
    cliente: "Cliente Rival",
  },
];

function pintar() {
  return render(
    <FormExhibicion tiendas={TIENDAS} marcas={MARCAS} skus={SKUS} />,
  );
}

function elegirTienda(id: string) {
  fireEvent.change(screen.getByLabelText("Tienda"), { target: { value: id } });
}

function rellenarObligatorios() {
  fireEvent.change(screen.getByLabelText(/Marca que lo negocia/), {
    target: { value: "m-mrc" },
  });
  fireEvent.change(screen.getByLabelText(/Tipo de espacio/), {
    target: { value: "cabecera" },
  });
  fireEvent.change(screen.getByLabelText("Desde"), {
    target: { value: "2026-09-01" },
  });
  fireEvent.change(screen.getByLabelText("Hasta"), {
    target: { value: "2026-09-30" },
  });
}

function enviar() {
  fireEvent.submit(screen.getByRole("button", { name: /Crear/ }));
}

beforeEach(() => {
  crear.mockReset();
  crear.mockResolvedValue({ ok: true });
});

describe("FormExhibicion", () => {
  it("solo ofrece las marcas del cliente de la tienda elegida", () => {
    pintar();

    expect(screen.getByRole("option", { name: "Maracumango" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Marca Rival" })).toBeNull();
  });

  it("al cambiar de tienda cambian las marcas ofrecidas", () => {
    pintar();
    elegirTienda("t-riv");

    expect(screen.getByRole("option", { name: "Marca Rival" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Maracumango" })).toBeNull();
  });

  it("solo ofrece los SKUs del cliente de la tienda elegida", () => {
    pintar();

    expect(screen.getByLabelText(/MRC-001/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/RIV-001/)).toBeNull();
  });

  it("cambiar de tienda DESMARCA los SKUs del cliente anterior", () => {
    // El bug que esto cierra: los SKUs marcados dejan de verse al cambiar de
    // cliente, pero seguirían en el estado y se guardarían — y la base no los
    // rechaza, porque `sku_ids` no tiene FK.
    pintar();
    fireEvent.click(screen.getByLabelText(/MRC-001/));
    elegirTienda("t-riv");
    elegirTienda("t-mrc");

    expect(screen.getByLabelText(/MRC-001/)).not.toBeChecked();
  });

  it("cambiar de tienda limpia también la marca elegida", () => {
    pintar();
    fireEvent.change(screen.getByLabelText(/Marca que lo negocia/), {
      target: { value: "m-mrc" },
    });
    elegirTienda("t-riv");

    // Sin control, el navegador sustituiría la marca desaparecida por la primera
    // de la lista nueva sin decir nada.
    expect(screen.getByLabelText(/Marca que lo negocia/)).toHaveValue("");
  });

  it("las unidades en blanco viajan como null, no como cero", async () => {
    // `Number("")` da 0, que es un compromiso de cero unidades — otra cosa que
    // "sin cantidad pactada".
    pintar();
    rellenarObligatorios();
    enviar();

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0]?.[0]).toMatchObject({
      cantidad_sugerida: null,
    });
  });

  it("manda el tenant de la tienda, no uno elegido aparte", async () => {
    pintar();
    rellenarObligatorios();
    enviar();

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0]?.[0]).toMatchObject({
      tenant_id: MARACUMANGO,
      tienda_id: "t-mrc",
    });
  });

  it("sin tiendas o sin marcas lo dice en vez de pintar un formulario inútil", () => {
    render(<FormExhibicion tiendas={[]} marcas={MARCAS} skus={SKUS} />);

    expect(screen.getByText(/falta alguna de las dos/i)).toBeInTheDocument();
  });
});
