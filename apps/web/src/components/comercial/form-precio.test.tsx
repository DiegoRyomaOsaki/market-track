import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FormPrecio } from "./form-precio";

// Lo que se fija aquí es de quién es la fila que se escribe: el `tenant_id`
// sale del SKU ELEGIDO, no de la cookie del header ni de un selector aparte.
// La FK compuesta lo impediría igual en la base, pero este es el contrato que
// hace que el error nunca llegue a producirse.

const { crear, buscarSkusFalso } = vi.hoisted(() => ({
  crear: vi.fn(),
  buscarSkusFalso: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/comercial/acciones", () => ({
  crearPrecio: crear,
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
  crear.mockReset();
  crear.mockResolvedValue({ ok: true });
  buscarSkusFalso.mockReset();
  buscarSkusFalso.mockResolvedValue({ ok: true, opciones: [SKU] });
});

describe("FormPrecio", () => {
  it("manda el tenant del SKU elegido, no uno elegido aparte", async () => {
    render(
      <FormPrecio tenantId={MARACUMANGO} skuInicial={SKU} cadenas={CADENAS} />,
    );
    rellenarYEnviar();

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0]?.[0]).toMatchObject({
      tenant_id: MARACUMANGO,
      sku_id: "s-mrc",
    });
  });

  it("buscar y elegir un SKU pone su id Y su tenant en el envío", async () => {
    render(<FormPrecio tenantId={MARACUMANGO} cadenas={CADENAS} />);
    fireEvent.change(screen.getByRole("combobox", { name: "SKU" }), {
      target: { value: "néctar" },
    });
    fireEvent.mouseDown(
      await screen.findByRole("option", { name: SKU.etiqueta }),
    );
    rellenarYEnviar();

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0]?.[0]).toMatchObject({
      tenant_id: MARACUMANGO,
      sku_id: "s-mrc",
    });
  });

  it("sin SKU elegido el envío va sin tenant: lo rechaza el servidor, no viaja el de la cookie", async () => {
    crear.mockResolvedValue({ ok: false, error: "Revisa el SKU" });
    render(<FormPrecio tenantId={MARACUMANGO} cadenas={CADENAS} />);
    rellenarYEnviar();

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0]?.[0]).toMatchObject({
      tenant_id: "",
      sku_id: "",
    });
    expect(await screen.findByText("Revisa el SKU")).toBeInTheDocument();
  });

  it("sin cadenas lo dice en vez de pintar un formulario inútil", () => {
    render(<FormPrecio tenantId={MARACUMANGO} cadenas={[]} />);

    expect(screen.getByText(/aún no tiene cadenas/i)).toBeInTheDocument();
  });
});
