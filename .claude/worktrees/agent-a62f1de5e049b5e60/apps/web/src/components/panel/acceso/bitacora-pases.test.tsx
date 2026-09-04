import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BitacoraPases, type FilaPase } from "./bitacora-pases";

vi.mock("./boton-revocar", () => ({
  BotonRevocar: ({ paseId }: { paseId: string }) => (
    <button type="button">Revocar {paseId}</button>
  ),
}));

const BASE: FilaPase = {
  id: "a0000020-0000-0000-0000-000000000001",
  usuario_nombre: "José Quispe",
  emisor_nombre: "Ana Torres",
  motivo: "No le llega el correo y está en tienda",
  estado: "vigente",
  generado_at: "2026-08-07T15:00:00.000Z",
};

function pintar(pases: FilaPase[] = [BASE]) {
  return render(<BitacoraPases pases={pases} />);
}

describe("BitacoraPases", () => {
  it("responde a quién dio acceso a quién y por qué", () => {
    // Es la única pregunta que esta tabla existe para contestar.
    pintar();
    expect(screen.getByText("José Quispe")).toBeInTheDocument();
    expect(screen.getByText("Ana Torres")).toBeInTheDocument();
    expect(screen.getByText(/No le llega el correo/)).toBeInTheDocument();
  });

  it("el estado lleva TEXTO, no solo un color", () => {
    pintar();
    expect(screen.getByText("Vigente")).toBeInTheDocument();
  });

  it("nombra los cuatro estados sin enseñar el valor crudo del enum", () => {
    pintar(
      (["vigente", "usado", "vencido", "revocado"] as const).map(
        (estado, i) => ({
          ...BASE,
          id: `a0000020-0000-0000-0000-00000000000${i}`,
          estado,
        }),
      ),
    );
    for (const etiqueta of ["Vigente", "Usado", "Vencido", "Revocado"]) {
      expect(screen.getByText(etiqueta)).toBeInTheDocument();
    }
    expect(screen.queryByText("vigente")).not.toBeInTheDocument();
  });

  it("solo se ofrece revocar lo que sigue vigente", () => {
    // Revocar un pase usado diría que nunca se usó; uno vencido ya no da acceso.
    pintar([
      { ...BASE, id: "p1", estado: "vigente" },
      { ...BASE, id: "p2", estado: "usado" },
      { ...BASE, id: "p3", estado: "vencido" },
      { ...BASE, id: "p4", estado: "revocado" },
    ]);
    expect(screen.getAllByRole("button", { name: /Revocar/ })).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Revocar p1" }),
    ).toBeInTheDocument();
  });

  it("un perfil que la RLS esconde deja un hueco, no borra la fila", () => {
    pintar([{ ...BASE, usuario_nombre: null, emisor_nombre: null }]);
    const fila = screen.getAllByRole("row")[1]!;
    expect(within(fila).getAllByText("—")).toHaveLength(2);
    expect(within(fila).getByText(/No le llega el correo/)).toBeInTheDocument();
  });

  it("la hora es la de Lima, que es donde se emitió", () => {
    // 15:00 UTC son las 10:00 en Lima.
    pintar();
    expect(screen.getByText(/10:00/)).toBeInTheDocument();
  });

  it("sin pases lo dice, en vez de una tabla vacía", () => {
    pintar([]);
    expect(
      screen.getByText(/no se ha emitido ningún pase/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("NUNCA enseña el código ni su hash", () => {
    // Ni siquiera llega al componente: la RPC no lo devuelve y la columna no
    // tiene grant de lectura. El test fija la promesa por si alguien la afloja.
    const { container } = pintar();
    expect(container.textContent).not.toMatch(/hash|codigo_hash/i);
  });
});
