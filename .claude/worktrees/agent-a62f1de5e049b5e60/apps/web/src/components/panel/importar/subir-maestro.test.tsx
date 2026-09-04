import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SubirMaestro } from "./subir-maestro";

const { validar, aplicar } = vi.hoisted(() => ({
  validar: vi.fn(),
  aplicar: vi.fn(),
}));

vi.mock("@/lib/importacion/acciones", () => ({
  validarImportacion: validar,
  aplicarImportacion: aplicar,
}));

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const IMPORTACION = "a0000017-0000-0000-0000-000000000001";

const ERROR_DE_FILA = {
  hoja: "tienda",
  fila: 14,
  columna: "cadena_codigo_externo",
  valor: "CAD-99",
  mensaje: "La cadena CAD-99 no existe",
};

function pintar() {
  return render(<SubirMaestro tenantId={TENANT} tenantNombre="Maracumango" />);
}

function elegirArchivo(nombre = "maestro.xlsx") {
  const entrada = screen.getByLabelText(/Excel del maestro/);
  fireEvent.change(entrada, {
    target: { files: [new File(["xlsx"], nombre)] },
  });
}

function previsualizar() {
  fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
}

beforeEach(() => {
  validar.mockReset();
  aplicar.mockReset();
  validar.mockResolvedValue({
    ok: true,
    importacionId: IMPORTACION,
    errores: [],
    erroresOmitidos: 0,
    resumen: { marca: 2, tienda: 30 },
  });
  aplicar.mockResolvedValue({ ok: true, resumen: { marca: 2, tienda: 30 } });
});

describe("SubirMaestro", () => {
  it("dice sobre QUÉ cliente-marca se va a importar", () => {
    // Aplicar el maestro al cliente equivocado le mete a una marca el catálogo
    // de otra. El nombre va en pantalla, no deducido del selector del header.
    pintar();
    expect(screen.getByText("Maracumango")).toBeInTheDocument();
  });

  it("sin archivo NO llama a la acción y lleva el foco a la entrada", () => {
    pintar();
    previsualizar();

    expect(validar).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Excel del maestro/)).toHaveFocus();
  });

  it("previsualizar no ofrece aplicar hasta que hay revisión", () => {
    pintar();
    expect(screen.queryByRole("button", { name: /Aplicar/ })).toBeNull();
  });

  it("con errores los enseña con su número de fila del Excel", async () => {
    validar.mockResolvedValue({
      ok: true,
      importacionId: IMPORTACION,
      errores: [ERROR_DE_FILA],
      erroresOmitidos: 0,
      resumen: { tienda: 0 },
    });
    pintar();
    elegirArchivo();
    previsualizar();

    expect(await screen.findByText("14")).toBeInTheDocument();
    expect(screen.getByText(/La cadena CAD-99 no existe/)).toBeInTheDocument();
  });

  it("con errores el botón de aplicar queda DESHABILITADO", async () => {
    // Es todo o nada: dejar pulsar solo produciría un fallo del servidor.
    validar.mockResolvedValue({
      ok: true,
      importacionId: IMPORTACION,
      errores: [ERROR_DE_FILA],
      erroresOmitidos: 0,
      resumen: { tienda: 0 },
    });
    pintar();
    elegirArchivo();
    previsualizar();

    expect(
      await screen.findByRole("button", { name: /Aplicar/ }),
    ).toBeDisabled();
  });

  it("avisa de cuántos errores se quedaron fuera del listado", async () => {
    validar.mockResolvedValue({
      ok: true,
      importacionId: IMPORTACION,
      errores: [ERROR_DE_FILA],
      erroresOmitidos: 37,
      resumen: { tienda: 0 },
    });
    pintar();
    elegirArchivo();
    previsualizar();

    expect(await screen.findByText(/37 errores más/)).toBeInTheDocument();
  });

  it("sin errores, aplicar manda EL MISMO archivo junto al id revisado", async () => {
    // El servidor re-lee y compara el hash: si aquí solo se mandara el id, esa
    // comprobación no tendría contra qué comparar.
    pintar();
    elegirArchivo();
    previsualizar();

    fireEvent.click(await screen.findByRole("button", { name: /Aplicar/ }));

    await waitFor(() => expect(aplicar).toHaveBeenCalled());
    const enviado = aplicar.mock.calls[0]?.[0] as FormData;
    expect(enviado.get("importacionId")).toBe(IMPORTACION);
    expect(enviado.get("archivo")).toBeInstanceOf(File);
  });

  it("aplicado, enseña el recuento escrito y retira el paso de revisión", async () => {
    pintar();
    elegirArchivo();
    previsualizar();
    fireEvent.click(await screen.findByRole("button", { name: /Aplicar/ }));

    expect(
      await screen.findByRole("heading", { name: /Maestro aplicado/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Filas escritas/)).toBeInTheDocument();
    // Una importación aplicada no se reaplica: la base lo impide y la pantalla
    // no debe invitar a intentarlo.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Aplicar/ })).toBeNull(),
    );
  });

  it("elegir OTRO archivo descarta la revisión anterior", async () => {
    // Enseñar los errores del anterior junto al nombre del nuevo es la forma más
    // directa de que alguien aplique lo que no revisó.
    pintar();
    elegirArchivo();
    previsualizar();
    await screen.findByRole("button", { name: /Aplicar/ });

    elegirArchivo("otro.xlsx");

    expect(screen.queryByRole("button", { name: /Aplicar/ })).toBeNull();
  });

  it("mientras revisa, el botón se bloquea y lo dice", async () => {
    // Sin esto, dos clics seguidos crean dos importaciones del mismo archivo.
    let responder = (_: unknown) => {};
    validar.mockReturnValue(
      new Promise((resolver) => {
        responder = resolver;
      }),
    );
    pintar();
    elegirArchivo();
    previsualizar();

    expect(
      await screen.findByRole("button", { name: /Revisando…/ }),
    ).toBeDisabled();

    // La transición se libera antes de terminar: una que se queda pendiente para
    // siempre deja a React con `isPending` puesto y contamina los tests que
    // vienen detrás.
    responder({
      ok: true,
      importacionId: IMPORTACION,
      errores: [],
      erroresOmitidos: 0,
      resumen: { marca: 1 },
    });
    await screen.findByRole("button", { name: /Aplicar/ });
  });

  it("un archivo sin ninguna hoja con datos lo dice, no enseña una lista vacía", async () => {
    validar.mockResolvedValue({
      ok: true,
      importacionId: IMPORTACION,
      errores: [],
      erroresOmitidos: 0,
      resumen: {},
    });
    pintar();
    elegirArchivo();
    previsualizar();

    expect(
      await screen.findByText(/ninguna hoja con datos/),
    ).toBeInTheDocument();
  });

  it("el fallo al APLICAR se lee junto a su botón, no en el paso de subir", async () => {
    aplicar.mockResolvedValue({
      ok: false,
      error: "El archivo no es el que se revisó",
    });
    pintar();
    elegirArchivo();
    previsualizar();
    const boton = await screen.findByRole("button", { name: /Aplicar/ });
    fireEvent.click(boton);

    const aviso = await screen.findByText(/no es el que se revisó/);
    // El paso 3 es el que contiene tanto el botón como su error.
    expect(aviso.closest("section")).toContainElement(boton);
  });

  it("anuncia el resultado de la revisión a quien no ve la pantalla", async () => {
    validar.mockResolvedValue({
      ok: true,
      importacionId: IMPORTACION,
      errores: [ERROR_DE_FILA],
      erroresOmitidos: 0,
      resumen: { tienda: 0 },
    });
    pintar();
    elegirArchivo();
    previsualizar();

    expect(
      await screen.findByText(/Revisión lista: 1 fila con problemas/),
    ).toBeInTheDocument();
  });

  it("un error de la acción se enseña y no deja revisión a medias", async () => {
    validar.mockResolvedValue({
      ok: false,
      error: "El archivo es demasiado grande",
    });
    pintar();
    elegirArchivo();
    previsualizar();

    expect(
      await screen.findByText(/El archivo es demasiado grande/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Aplicar/ })).toBeNull();
  });
});
