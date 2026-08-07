import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EmitirPase } from "./emitir-pase";

const { emitir, refresh } = vi.hoisted(() => ({
  emitir: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/panel/acciones-acceso", () => ({ emitirPase: emitir }));

const USUARIOS = [
  {
    id: "44444444-4444-4444-4444-444444444444",
    nombre: "José Quispe",
    dni: "10000004",
  },
];

function pintar(usuarios = USUARIOS) {
  return render(<EmitirPase usuarios={usuarios} />);
}

function escribirMotivo(texto: string) {
  fireEvent.change(screen.getByLabelText(/Motivo/), {
    target: { value: texto },
  });
}

function generar() {
  fireEvent.click(screen.getByRole("button", { name: /Generar pase/ }));
}

beforeEach(() => {
  emitir.mockReset();
  refresh.mockReset();
  emitir.mockResolvedValue({
    ok: true,
    codigo: "482913",
    expiraAt: "2099-01-01T00:00:00.000Z",
  });
});

describe("EmitirPase", () => {
  it("avisa ANTES de generar de que el código se ve una sola vez", () => {
    // Después sería tarde: si el operador no está listo para dictarlo, lo pierde.
    pintar();
    expect(screen.getByText(/una sola vez/i)).toBeInTheDocument();
  });

  it("dice que el canje todavía no funciona, en vez de dejar que lo descubran", () => {
    pintar();
    expect(
      screen.getByText(/aún no permite iniciar sesión/i),
    ).toBeInTheDocument();
  });

  it("sin motivo NO llama a la acción y lleva el foco al campo", () => {
    // El motivo es lo único que la bitácora podrá responder cuando alguien
    // pregunte por qué esta persona recibió acceso.
    pintar();
    generar();

    expect(emitir).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Motivo/)).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent(/por qué/i);
  });

  it("un motivo de solo espacios tampoco cuenta", () => {
    pintar();
    escribirMotivo("    ");
    generar();
    expect(emitir).not.toHaveBeenCalled();
  });

  it("con motivo, emite para el usuario elegido", async () => {
    pintar();
    escribirMotivo("No le llega el correo y está en tienda");
    generar();

    await waitFor(() =>
      expect(emitir).toHaveBeenCalledWith({
        profileId: USUARIOS[0]!.id,
        motivo: "No le llega el correo y está en tienda",
      }),
    );
  });

  it("enseña el código emitido", async () => {
    pintar();
    escribirMotivo("motivo");
    generar();

    expect(await screen.findByText("482 913")).toBeInTheDocument();
  });

  it("si falla lo dice y NO enseña ningún código", async () => {
    emitir.mockResolvedValue({ ok: false, error: "Límite diario alcanzado" });
    pintar();
    escribirMotivo("motivo");
    generar();

    expect(await screen.findByRole("alert")).toHaveTextContent(/Límite diario/);
    expect(screen.queryByText("482 913")).not.toBeInTheDocument();
  });

  it("mientras la emisión está en vuelo se deshabilita y lo dice", async () => {
    // Sin esto, dos clics seguidos emiten dos pases y gastan el límite diario.
    let resolver: (v: { ok: boolean }) => void = () => {};
    emitir.mockReturnValue(
      new Promise<{ ok: boolean }>((r) => {
        resolver = r;
      }),
    );
    pintar();
    escribirMotivo("motivo");
    generar();

    const boton = await screen.findByRole("button", { name: /Generando/ });
    expect(boton).toBeDisabled();

    resolver({ ok: false });
  });

  it("con varios mercaderistas, emite para el que se ELIGE", async () => {
    // Con una sola opción el test pasaría aunque el campo no viajara.
    const otro = {
      id: "55555555-5555-5555-5555-555555555555",
      nombre: "Rosa Medina",
      dni: "10000007",
    };
    pintar([...USUARIOS, otro]);
    fireEvent.change(screen.getByLabelText(/Mercaderista/), {
      target: { value: otro.id },
    });
    escribirMotivo("motivo");
    generar();

    await waitFor(() =>
      expect(emitir).toHaveBeenCalledWith({
        profileId: otro.id,
        motivo: "motivo",
      }),
    );
  });

  it("la región de error existe desde el primer render, aunque esté vacía", () => {
    // Un `role="alert"` que se monta al fallar se lo pierden algunos lectores.
    pintar();
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });

  it("sin mercaderistas a los que emitir, lo dice en vez de un desplegable vacío", () => {
    pintar([]);
    expect(
      screen.getByText(/No hay mercaderistas activos/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Generar/ }),
    ).not.toBeInTheDocument();
  });
});
