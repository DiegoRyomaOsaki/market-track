import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TOPE_LISTADO } from "@/lib/comercial/listado";

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

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () =>
    Promise.resolve({
      from: () => ({
        select: () => ({
          order: () => ({ limit: () => Promise.resolve(consulta) }),
        }),
      }),
    }),
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
    render(await VistaPrecios());

    expect(screen.getByText("Toda la cadena")).toBeInTheDocument();
  });

  it("el importe lleva su símbolo y sus dos decimales", async () => {
    consulta.data = [PRECIO];
    render(await VistaPrecios());

    expect(screen.getByText("S/ 6.90")).toBeInTheDocument();
  });

  it("sin precios explica por dónde entran, no solo que no hay", async () => {
    render(await VistaPrecios());

    expect(screen.getByText(/importación del Excel/i)).toBeInTheDocument();
  });

  it("un fallo de la consulta se dice, no se pinta una tabla vacía", async () => {
    consulta.data = null;
    consulta.error = { message: "permission denied" };
    render(await VistaPrecios());

    expect(screen.getByText(/No se pudieron cargar/i)).toBeInTheDocument();
  });

  it("cuando recorta el listado lo DICE", async () => {
    // Un corte silencioso se lee como "esto es todo lo que hay", y la cuenta que
    // alguien saque de la pantalla no cuadrará con la de la base.
    consulta.data = Array.from({ length: TOPE_LISTADO + 1 }, (_, i) => ({
      ...PRECIO,
      id: `p${i}`,
    }));
    render(await VistaPrecios());

    expect(
      screen.getByText(/todavía no tiene paginación/i),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(TOPE_LISTADO + 1); // + cabecera
  });

  it("por debajo del tope no avisa de nada", async () => {
    consulta.data = [PRECIO];
    render(await VistaPrecios());

    expect(screen.queryByText(/paginación/i)).toBeNull();
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
    render(await VistaPromociones());

    expect(screen.getByText("Todas las tiendas")).toBeInTheDocument();
  });

  it("con clusters los enumera", async () => {
    consulta.data = [{ ...PROMO, clusters: ["Lima Norte", "Lima Sur"] }];
    render(await VistaPromociones());

    expect(screen.getByText("Lima Norte, Lima Sur")).toBeInTheDocument();
  });

  it("si está comunicada o no lo dice con TEXTO, no solo con color", async () => {
    consulta.data = [PROMO];
    render(await VistaPromociones());

    expect(screen.getByText("Sin comunicar")).toBeInTheDocument();
  });

  it("un fallo de la consulta se dice", async () => {
    consulta.data = null;
    consulta.error = { message: "permission denied" };
    render(await VistaPromociones());

    expect(screen.getByText(/No se pudieron cargar/i)).toBeInTheDocument();
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
    render(await VistaExhibiciones());

    expect(screen.getByText("Sin definir")).toBeInTheDocument();
  });

  it("cuenta los SKUs en vez de listarlos: una cabecera puede llevar veinte", async () => {
    consulta.data = [{ ...EXHIBICION, sku_ids: ["a", "b", "c"] }];
    render(await VistaExhibiciones());

    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("nombra la tienda y la marca que negoció el espacio", async () => {
    consulta.data = [EXHIBICION];
    render(await VistaExhibiciones());

    expect(screen.getByText("Plaza Vea Angamos")).toBeInTheDocument();
    expect(screen.getByText("Maracumango")).toBeInTheDocument();
  });

  it("un fallo de la consulta se dice", async () => {
    consulta.data = null;
    consulta.error = { message: "permission denied" };
    render(await VistaExhibiciones());

    expect(screen.getByText(/No se pudieron cargar/i)).toBeInTheDocument();
  });
});
