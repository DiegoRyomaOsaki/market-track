import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DefinicionBorrador } from "@/lib/formularios/schema";

import { ConstructorFormulario } from "./constructor-formulario";

// La sustancia de este archivo es «se anuncia / no se anuncia» y «dónde queda el
// foco», así que todo se consulta por ROL: `getByText` encuentra la cadena en el
// DOM aunque esté fuera del árbol de accesibilidad, y entonces no probaría nada
// de lo que dice probar.

const guardarBorrador =
  vi.fn<(id: string, datos: unknown) => Promise<unknown>>();
const publicarFormulario =
  vi.fn<(id: string, datos: unknown) => Promise<unknown>>();

vi.mock("@/lib/formularios/acciones", () => ({
  guardarBorrador: (id: string, datos: unknown): Promise<unknown> =>
    guardarBorrador(id, datos),
  publicarFormulario: (id: string, datos: unknown): Promise<unknown> =>
    publicarFormulario(id, datos),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function definicion(pasos: DefinicionBorrador["pasos"]): DefinicionBorrador {
  return { pasos };
}

/** Un formulario ya válido: sirve para probar Publicar sin pelear con los avisos. */
const DOS_PASOS: DefinicionBorrador = definicion([
  {
    id: "p1",
    titulo: "Primer paso",
    orden: 0,
    campos: [
      { id: "c1", tipo: "texto", etiqueta: "Primer campo", obligatorio: false },
      {
        id: "c2",
        tipo: "texto",
        etiqueta: "Segundo campo",
        obligatorio: false,
      },
    ],
  },
  {
    id: "p2",
    titulo: "Segundo paso",
    orden: 1,
    campos: [
      { id: "c3", tipo: "texto", etiqueta: "Tercer campo", obligatorio: false },
    ],
  },
]);

function montar(def: DefinicionBorrador = DOS_PASOS) {
  return render(
    <ConstructorFormulario
      formularioId="f1"
      nombreInicial="Formulario de prueba"
      activoInicial
      cliente="Maracumango"
      marca="Oster"
      ambito="levantamiento"
      definicionInicial={def}
      versionPublicada={null}
      publicadaAt={null}
    />,
  );
}

/** La región de resultado de la operación (guardar/publicar). */
function regionResultado(): HTMLElement {
  const region = screen
    .getAllByRole("status")
    .find((r) => !r.className.includes("sr-only"));
  if (!region) throw new Error("No existe la región de resultado");
  return region;
}

/** La región que narra los cambios de estructura (agregar/eliminar). */
function regionAnuncio(): HTMLElement {
  const region = screen
    .getAllByRole("status")
    .find((r) => r.className.includes("sr-only"));
  if (!region) throw new Error("No existe la región de anuncios");
  return region;
}

beforeEach(() => {
  guardarBorrador.mockReset();
  publicarFormulario.mockReset();
  guardarBorrador.mockResolvedValue({ ok: true });
  publicarFormulario.mockResolvedValue({ ok: true });
});

describe("ConstructorFormulario — confirmación por lector de pantalla", () => {
  it("las regiones vivas existen desde el PRIMER render, antes de guardar nada", () => {
    // El corazón del ticket. Una región que se monta al terminar la operación se
    // anuncia en el mismo instante en que se inserta, y algunos lectores se la
    // pierden — justo en el primer intento. Montarla siempre y cambiarle el
    // texto es lo único que lo evita, así que se prueba que ya está ahí con el
    // formulario recién abierto y sin nada que decir.
    montar();

    expect(regionResultado()).toBeInTheDocument();
    expect(regionResultado()).toBeEmptyDOMElement();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });

  it("guardar el borrador se confirma por la región viva, no solo en pantalla", async () => {
    montar();

    fireEvent.click(screen.getByRole("button", { name: /guardar borrador/i }));

    await waitFor(() =>
      expect(regionResultado()).toHaveTextContent("Borrador guardado."),
    );
  });

  it("publicar se confirma por la región viva", async () => {
    montar();

    fireEvent.click(screen.getByRole("button", { name: /^publicar$/i }));

    await waitFor(() =>
      expect(regionResultado()).toHaveTextContent(
        "Formulario publicado. El móvil recibirá esta versión.",
      ),
    );
  });

  it("el fallo del servidor va por `alert`, que es urgente, y no por `status`", async () => {
    guardarBorrador.mockResolvedValue({
      ok: false,
      error: "No tienes permiso",
    });
    montar();

    fireEvent.click(screen.getByRole("button", { name: /guardar borrador/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("No tienes permiso"),
    );
    expect(regionResultado()).toBeEmptyDOMElement();
  });
});

describe("ConstructorFormulario — foco al agregar", () => {
  it("agregar un paso deja el foco en el título del paso nuevo", async () => {
    montar();

    fireEvent.click(screen.getByRole("button", { name: /agregar paso/i }));

    await waitFor(() =>
      expect(screen.getByLabelText("Título del paso 3")).toHaveFocus(),
    );
  });

  it("agregar un campo deja el foco en la etiqueta del campo nuevo", async () => {
    montar();

    // El primer paso trae dos campos; el botón del primer paso es el primero.
    fireEvent.click(
      screen.getAllByRole("button", { name: /agregar campo/i })[0]!,
    );

    await waitFor(() => {
      const etiquetas = screen.getAllByLabelText("Etiqueta");
      // El nuevo es el tercero del documento: dos del primer paso y el suyo.
      expect(etiquetas[2]).toHaveFocus();
    });
  });
});

describe("ConstructorFormulario — foco y anuncio al eliminar", () => {
  it("eliminar un campo mueve el foco al de arriba, no al `<body>`", async () => {
    montar();

    fireEvent.click(
      screen.getByRole("button", { name: /eliminar el campo Segundo campo/i }),
    );

    await waitFor(() =>
      expect(screen.getByDisplayValue("Primer campo")).toHaveFocus(),
    );
    expect(document.body).not.toHaveFocus();
  });

  it("eliminar el PRIMER campo cae en el botón de agregar, que es el vecino que queda", async () => {
    montar();

    fireEvent.click(
      screen.getByRole("button", { name: /eliminar el campo Primer campo/i }),
    );

    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: /agregar campo/i })[0],
      ).toHaveFocus(),
    );
  });

  it("eliminar un campo dice CUÁL se eliminó y cuántos quedan", async () => {
    // Sin esto el botón que tenía el foco desaparece con su fila y el lector no
    // anuncia nada: la fila se esfuma en silencio.
    montar();

    fireEvent.click(
      screen.getByRole("button", { name: /eliminar el campo Segundo campo/i }),
    );

    await waitFor(() =>
      expect(regionAnuncio()).toHaveTextContent(
        "Campo Segundo campo eliminado. Queda 1 campo.",
      ),
    );
  });

  it("eliminar un paso mueve el foco al paso anterior y lo anuncia", async () => {
    montar();

    fireEvent.click(
      screen.getByRole("button", { name: /eliminar el paso 2/i }),
    );

    await waitFor(() =>
      expect(screen.getByDisplayValue("Primer paso")).toHaveFocus(),
    );
    expect(regionAnuncio()).toHaveTextContent(
      "Paso Segundo paso eliminado. Queda 1 paso.",
    );
  });

  it("eliminar el ÚLTIMO paso que queda cae en el botón de agregar", async () => {
    montar(
      definicion([{ id: "p1", titulo: "Único paso", orden: 0, campos: [] }]),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /eliminar el paso 1/i }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /agregar paso/i }),
      ).toHaveFocus(),
    );
    expect(regionAnuncio()).toHaveTextContent(
      "Paso Único paso eliminado. No queda ningún paso.",
    );
  });

  it("dos borrados seguidos suenan los dos: el texto cambia con el recuento", async () => {
    // Una región viva cuyo texto no cambia NO se vuelve a anunciar. Sin el
    // recuento, borrar dos campos daría el mismo string y el segundo sería mudo.
    montar();

    fireEvent.click(
      screen.getByRole("button", { name: /eliminar el campo Segundo campo/i }),
    );
    await waitFor(() =>
      expect(regionAnuncio()).toHaveTextContent("Queda 1 campo."),
    );
    const primero = regionAnuncio().textContent;

    fireEvent.click(
      screen.getByRole("button", { name: /eliminar el campo Primer campo/i }),
    );
    await waitFor(() =>
      expect(regionAnuncio()).toHaveTextContent("No queda ningún campo."),
    );

    expect(regionAnuncio().textContent).not.toBe(primero);
  });
});
