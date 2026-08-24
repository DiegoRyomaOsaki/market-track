import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FormExhibicion } from "./form-exhibicion";

// Lo que se prueba aquí es el camino de los SKUs elegidos por el buscador.
//
// `exhibicion_negociada.sku_ids` es un `uuid[]` sin clave foránea: la base no
// comprueba de quién es cada elemento. Lo que viaja en el envío es EXACTAMENTE
// la lista de fichas que el operador ve — añadir, quitar y no duplicar.

const { crear, buscarSkusFalso, buscarTiendasFalso } = vi.hoisted(() => ({
  crear: vi.fn(),
  buscarSkusFalso: vi.fn(),
  buscarTiendasFalso: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/comercial/acciones", () => ({
  crearExhibicion: crear,
  editarExhibicion: vi.fn(),
}));
vi.mock("@/lib/comercial/buscar-opciones", () => ({
  buscarSkus: buscarSkusFalso,
  buscarTiendas: buscarTiendasFalso,
}));

const MARACUMANGO = "aaaaaaaa-0000-0000-0000-000000000001";

const MARCAS = [{ id: "m-mrc", nombre: "Maracumango", tenant_id: MARACUMANGO }];

const TIENDA = {
  id: "t-mrc",
  etiqueta: "Plaza Vea · Angamos",
  tenant_id: MARACUMANGO,
};

const SKU = {
  id: "s-mrc",
  etiqueta: "MRC-001 · Néctar 1L",
  tenant_id: MARACUMANGO,
};

function pintar() {
  return render(
    <FormExhibicion
      tenantId={MARACUMANGO}
      tiendaInicial={TIENDA}
      marcas={MARCAS}
    />,
  );
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

async function buscarYElegirSku() {
  fireEvent.change(screen.getByRole("combobox", { name: "Añadir SKU" }), {
    target: { value: "néctar" },
  });
  const opcion = await screen.findByRole("option", { name: SKU.etiqueta });
  fireEvent.mouseDown(opcion);
}

function enviar() {
  fireEvent.submit(screen.getByRole("button", { name: /Crear/ }));
}

beforeEach(() => {
  crear.mockReset();
  crear.mockResolvedValue({ ok: true });
  buscarSkusFalso.mockReset();
  buscarSkusFalso.mockResolvedValue({ ok: true, opciones: [SKU] });
  buscarTiendasFalso.mockReset();
  buscarTiendasFalso.mockResolvedValue({ ok: true, opciones: [TIENDA] });
});

describe("FormExhibicion", () => {
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

  it("manda el tenant de la TIENDA elegida, no uno elegido aparte", async () => {
    pintar();
    rellenarObligatorios();
    enviar();

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0]?.[0]).toMatchObject({
      tenant_id: MARACUMANGO,
      tienda_id: "t-mrc",
    });
  });

  it("buscar y elegir un SKU lo añade como ficha y viaja en el envío", async () => {
    pintar();
    rellenarObligatorios();
    await buscarYElegirSku();

    expect(screen.getByText(SKU.etiqueta)).toBeInTheDocument();

    enviar();
    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0]?.[0]).toMatchObject({ sku_ids: ["s-mrc"] });
  });

  it("elegir el mismo SKU dos veces deja UNA ficha", async () => {
    pintar();
    await buscarYElegirSku();
    await buscarYElegirSku();

    expect(screen.getAllByText(SKU.etiqueta)).toHaveLength(1);
  });

  it("quitar la ficha lo saca del envío", async () => {
    // Si la ficha desaparece de la vista pero queda en el estado, el operador
    // guarda un SKU que ya no ve — el mismo bug que motivó este archivo.
    pintar();
    rellenarObligatorios();
    await buscarYElegirSku();
    fireEvent.click(
      screen.getByRole("button", { name: `Quitar ${SKU.etiqueta}` }),
    );

    expect(screen.queryByText(SKU.etiqueta)).toBeNull();

    enviar();
    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0]?.[0]).toMatchObject({ sku_ids: [] });
  });

  it("sin marcas lo dice en vez de pintar un formulario inútil", () => {
    render(<FormExhibicion tenantId={MARACUMANGO} marcas={[]} />);

    expect(screen.getByText(/aún no tiene marcas/i)).toBeInTheDocument();
  });
});
