import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FormPrecio } from "./form-precio";

// Lo que se fija aquí es de quién es la fila que se escribe. El formulario ya no
// manda `tenant_id` EN ABSOLUTO: lo deriva la base de la fila del SKU, dentro de
// la RPC que cierra el periodo anterior y abre el nuevo. Es una garantía más
// fuerte que mandarlo bien — un cuerpo manipulado tampoco puede elegir cliente.

const { abrir, buscarSkusFalso } = vi.hoisted(() => ({
  abrir: vi.fn(),
  buscarSkusFalso: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/comercial/acciones", () => ({
  abrirPeriodoPrecio: abrir,
  editarPrecio: vi.fn(),
}));
vi.mock("@/lib/comercial/buscar-opciones", () => ({
  buscarSkus: buscarSkusFalso,
  buscarTiendas: vi.fn(),
}));

const MARACUMANGO = "aaaaaaaa-0000-0000-0000-000000000001";

const SKU = {
  id: "s-mrc",
  etiqueta: "MRC-001 · Néctar 1L",
  tenant_id: MARACUMANGO,
};

const CADENAS = [{ id: "c1", nombre: "Plaza Vea", tenant_id: MARACUMANGO }];

function rellenarYEnviar() {
  fireEvent.change(screen.getByLabelText("Cadena"), {
    target: { value: "c1" },
  });
  fireEvent.change(screen.getByLabelText(/Precio regular/), {
    target: { value: "6.90" },
  });
  fireEvent.change(screen.getByLabelText("Vigente desde"), {
    target: { value: "2026-09-01" },
  });
  fireEvent.submit(screen.getByRole("button", { name: /Crear/ }));
}

beforeEach(() => {
  abrir.mockReset();
  abrir.mockResolvedValue({ ok: true });
  buscarSkusFalso.mockReset();
  buscarSkusFalso.mockResolvedValue({ ok: true, opciones: [SKU] });
});

describe("FormPrecio", () => {
  it("NO manda `tenant_id`: el cliente lo deriva la base del SKU", async () => {
    render(
      <FormPrecio tenantId={MARACUMANGO} skuInicial={SKU} cadenas={CADENAS} />,
    );
    rellenarYEnviar();

    await waitFor(() => expect(abrir).toHaveBeenCalled());
    expect(abrir.mock.calls[0]?.[0]).toMatchObject({ sku_id: "s-mrc" });
    expect(abrir.mock.calls[0]?.[0]).not.toHaveProperty("tenant_id");
  });

  it("buscar y elegir un SKU pone su id en el envío", async () => {
    render(<FormPrecio tenantId={MARACUMANGO} cadenas={CADENAS} />);
    fireEvent.change(screen.getByRole("combobox", { name: "SKU" }), {
      target: { value: "néctar" },
    });
    fireEvent.mouseDown(
      await screen.findByRole("option", { name: SKU.etiqueta }),
    );
    rellenarYEnviar();

    await waitFor(() => expect(abrir).toHaveBeenCalled());
    expect(abrir.mock.calls[0]?.[0]).toMatchObject({ sku_id: "s-mrc" });
  });

  it("sin SKU elegido el envío va vacío y lo rechaza el servidor", async () => {
    abrir.mockResolvedValue({ ok: false, error: "Revisa el SKU" });
    render(<FormPrecio tenantId={MARACUMANGO} cadenas={CADENAS} />);
    rellenarYEnviar();

    await waitFor(() => expect(abrir).toHaveBeenCalled());
    expect(abrir.mock.calls[0]?.[0]).toMatchObject({ sku_id: "" });
    expect(await screen.findByText("Revisa el SKU")).toBeInTheDocument();
  });

  it("sin cadenas lo dice en vez de pintar un formulario inútil", () => {
    render(<FormPrecio tenantId={MARACUMANGO} cadenas={[]} />);

    expect(screen.getByText(/aún no tiene cadenas/i)).toBeInTheDocument();
  });
});
