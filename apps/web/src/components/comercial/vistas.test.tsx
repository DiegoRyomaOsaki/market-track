import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TAMANO_PAGINA } from "@/lib/panel/listado";

import { VistaExhibiciones } from "./vista-exhibiciones";
import { VistaPrecios } from "./vista-precios";
import { VistaPromociones } from "./vista-promociones";

// Las tres tablas comerciales en un archivo: comparten el doble de Supabase y lo
// que se prueba de cada una es lo mismo —cómo se pinta lo que la fila NO trae—.
// Un campo vacío dibujado como hueco deja al operador sin saber si el dato falta
// o si significa "todo".

const { consulta } = vi.hoisted(() => ({
  consulta: {
    data: [] as Record<string, unknown>[] | null,
    error: null as { message: string } | null,
  },
}));

vi.mock("@/lib/panel/tenant-activo", () => ({
  tenantActivo: () => Promise.resolve({ id: "t1", nombre: "Maracumango" }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => {
    const encadenable = {
      select: () => encadenable,
      eq: () => encadenable,
      order: () => encadenable,
      range: () => Promise.resolve(consulta),
    };
    return Promise.resolve({ from: () => encadenable });
  },
}));

beforeEach(() => {
  consulta.data = [];
  consulta.error = null;
});

describe("VistaPrecios", () => {
  const PRECIO = {
    id: "p1",
    precio: 6.9,
    tipo_tienda: null,
    vigente_desde: "2026-09-01",
    sku: { codigo: "MRC-001", nombre: "Néctar Maracumango 1L" },
    cadena: { nombre: "Plaza Vea" },
  };

  it("un precio sin tipo de tienda se lee como «Toda la cadena»", async () => {
    // Un guion dejaría en duda si falta el dato o si aplica a todos los formatos.
    consulta.data = [PRECIO];
    render(await VistaPrecios({ pagina: 1 }));

    expect(screen.getByText("Toda la cadena")).toBeInTheDocument();
  });

  it("el importe lleva su símbolo y sus dos decimales", async () => {
    consulta.data = [PRECIO];
    render(await VistaPrecios({ pagina: 1 }));

    expect(screen.getByText("S/ 6.90")).toBeInTheDocument();
  });

  it("sin precios explica por dónde entran, no solo que no hay", async () => {
    render(await VistaPrecios({ pagina: 1 }));

    expect(screen.getByText(/importación del Excel/i)).toBeInTheDocument();
  });

  it("un fallo de la consulta se dice, no se pinta una tabla vacía", async () => {
    consulta.data = null;
    consulta.error = { message: "permission denied" };
    render(await VistaPrecios({ pagina: 1 }));

    expect(screen.getByText(/No se pudieron cargar/i)).toBeInTheDocument();
  });

  it("con más filas que una página, ofrece la siguiente y no pinta la sonda", async () => {
    // La fila de más existe solo para saber que hay otra página: mostrarla
    // duplicaría la primera fila de la página siguiente.
    consulta.data = Array.from({ length: TAMANO_PAGINA + 1 }, (_, i) => ({
      ...PRECIO,
      id: `p${i}`,
    }));
    render(await VistaPrecios({ pagina: 1 }));

    expect(screen.getByRole("link", { name: /Siguiente/ })).toHaveAttribute(
      "href",
      "/admin/precios?p=2",
    );
    expect(screen.getAllByRole("row")).toHaveLength(TAMANO_PAGINA + 1); // + cabecera
  });

  it("una página exactamente llena NO ofrece siguiente", async () => {
    // El off-by-one que haría que un listado completo pareciera recortado.
    consulta.data = Array.from({ length: TAMANO_PAGINA }, (_, i) => ({
      ...PRECIO,
      id: `p${i}`,
    }));
    render(await VistaPrecios({ pagina: 1 }));

    expect(screen.queryByRole("link", { name: /Siguiente/ })).toBeNull();
  });

  it("una página fuera de rango lo dice, no finge que no hay datos", async () => {
    consulta.data = [];
    render(await VistaPrecios({ pagina: 3 }));

    expect(screen.getByText(/Esta página está vacía/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Volver a la primera/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/importación del Excel/i)).toBeNull();
  });

  it("en una página intermedia se puede volver atrás", async () => {
    consulta.data = [PRECIO];
    render(await VistaPrecios({ pagina: 2 }));

    expect(screen.getByRole("link", { name: /Anterior/ })).toHaveAttribute(
      "href",
      "/admin/precios?p=1",
    );
  });
});

describe("VistaPromociones", () => {
  const PROMO = {
    id: "pr1",
    precio_promo: 5.9,
    fecha_inicio: "2026-09-01",
    fecha_fin: "2026-09-30",
    clusters: [] as string[],
    comunicada: false,
    sku: { codigo: "MRC-001", nombre: "Néctar Maracumango 1L" },
  };

  it("sin clusters se lee como «Todas las tiendas»", async () => {
    // Es el caso normal y el más fácil de malinterpretar como "ninguna".
    consulta.data = [PROMO];
    render(await VistaPromociones({ pagina: 1 }));

    expect(screen.getByText("Todas las tiendas")).toBeInTheDocument();
  });

  it("con clusters los enumera", async () => {
    consulta.data = [{ ...PROMO, clusters: ["Lima Norte", "Lima Sur"] }];
    render(await VistaPromociones({ pagina: 1 }));

    expect(screen.getByText("Lima Norte, Lima Sur")).toBeInTheDocument();
  });

  it("si está comunicada o no lo dice con TEXTO, no solo con color", async () => {
    consulta.data = [PROMO];
    render(await VistaPromociones({ pagina: 1 }));

    expect(screen.getByText("Sin comunicar")).toBeInTheDocument();
  });

  it("un fallo de la consulta se dice", async () => {
    consulta.data = null;
    consulta.error = { message: "permission denied" };
    render(await VistaPromociones({ pagina: 1 }));

    expect(screen.getByText(/No se pudieron cargar/i)).toBeInTheDocument();
  });

  it("la página siguiente conserva la pestaña de promociones", async () => {
    // Sin `vista=promociones` en el href, avanzar de página saltaría a precios.
    consulta.data = Array.from({ length: TAMANO_PAGINA + 1 }, (_, i) => ({
      ...PROMO,
      id: `pr${i}`,
    }));
    render(await VistaPromociones({ pagina: 1 }));

    expect(screen.getByRole("link", { name: /Siguiente/ })).toHaveAttribute(
      "href",
      "/admin/precios?vista=promociones&p=2",
    );
  });
});

describe("VistaExhibiciones", () => {
  const EXHIBICION = {
    id: "e1",
    tipo: "cabecera",
    sku_ids: [] as string[],
    cantidad_sugerida: null,
    fecha_inicio: "2026-09-01",
    fecha_fin: "2026-09-30",
    tienda: { nombre: "Plaza Vea Angamos" },
    marca: { nombre: "Maracumango" },
  };

  it("un espacio todavía sin SKUs se lee «Sin definir», no «0»", async () => {
    // Cero SKUs pactados y "aún no decidido" son cosas distintas.
    consulta.data = [EXHIBICION];
    render(await VistaExhibiciones({ pagina: 1 }));

    expect(screen.getByText("Sin definir")).toBeInTheDocument();
  });

  it("cuenta los SKUs en vez de listarlos: una cabecera puede llevar veinte", async () => {
    consulta.data = [{ ...EXHIBICION, sku_ids: ["a", "b", "c"] }];
    render(await VistaExhibiciones({ pagina: 1 }));

    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("nombra la tienda y la marca que negoció el espacio", async () => {
    consulta.data = [EXHIBICION];
    render(await VistaExhibiciones({ pagina: 1 }));

    expect(screen.getByText("Plaza Vea Angamos")).toBeInTheDocument();
    expect(screen.getByText("Maracumango")).toBeInTheDocument();
  });

  it("un fallo de la consulta se dice", async () => {
    consulta.data = null;
    consulta.error = { message: "permission denied" };
    render(await VistaExhibiciones({ pagina: 1 }));

    expect(screen.getByText(/No se pudieron cargar/i)).toBeInTheDocument();
  });
});
