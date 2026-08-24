import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FormPromocion } from "./form-promocion";

// El mismo contrato que FormPrecio: el `tenant_id` de la fila sale del SKU
// elegido. Y los clusters que viajan son EXACTAMENTE los marcados — acotan a
// qué tiendas aplica la promo, y uno de más o de menos la manda a otro sitio.

const { crear, buscarSkusFalso } = vi.hoisted(() => ({
  crear: vi.fn(),
  buscarSkusFalso: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/comercial/acciones", () => ({
  crearPromocion: crear,
  editarPromocion: vi.fn(),
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

function pintar(clusters: string[] = []) {
  return render(
    <FormPromocion
      tenantId={MARACUMANGO}
      skuInicial={SKU}
      clusters={clusters}
    />,
  );
}

function rellenarYEnviar() {
  fireEvent.change(screen.getByLabelText(/Precio promocional/), {
    target: { value: "4.90" },
  });
  fireEvent.change(screen.getByLabelText("Desde"), {
    target: { value: "2026-09-01" },
  });
  fireEvent.change(screen.getByLabelText("Hasta"), {
    target: { value: "2026-09-30" },
  });
  fireEvent.submit(screen.getByRole("button", { name: /Crear/ }));
}

beforeEach(() => {
  crear.mockReset();
  crear.mockResolvedValue({ ok: true });
  buscarSkusFalso.mockReset();
  buscarSkusFalso.mockResolvedValue({ ok: true, opciones: [SKU] });
});

describe("FormPromocion", () => {
  it("manda el tenant del SKU elegido, no uno elegido aparte", async () => {
    pintar();
    rellenarYEnviar();

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0]?.[0]).toMatchObject({
      tenant_id: MARACUMANGO,
      sku_id: "s-mrc",
    });
  });

  it("los clusters marcados viajan; los demás no", async () => {
    pintar(["Lima Norte", "Lima Sur"]);
    fireEvent.click(screen.getByLabelText("Lima Norte"));
    rellenarYEnviar();

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0]?.[0]).toMatchObject({
      clusters: ["Lima Norte"],
    });
  });

  it("sin clusters en las tiendas del cliente lo explica: aplica a todas", () => {
    pintar([]);

    expect(
      screen.getByText(/Ninguna tienda tiene cluster asignado/),
    ).toBeInTheDocument();
  });
});
