import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EditorEscalera } from "./editor-escalera";

const publicar = vi.fn<(datos: unknown) => Promise<unknown>>();
vi.mock("@/lib/metricas/acciones", () => ({
  publicarEscaleraBono: (d: unknown): Promise<unknown> => publicar(d),
}));

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const HOY = "2026-08-13";

const VIGENTE = [
  {
    id: "1",
    nombre: "Bronce",
    puntaje_min: 60,
    monto: 100,
    vigente_desde: "2026-01-01",
  },
  {
    id: "2",
    nombre: "Plata",
    puntaje_min: 80,
    monto: 250,
    vigente_desde: "2026-01-01",
  },
];

beforeEach(() => {
  publicar.mockReset();
  publicar.mockResolvedValue({ ok: true });
});

function montar(soloLectura = false, vigente = VIGENTE) {
  render(
    <EditorEscalera
      tenantId={TENANT}
      vigente={vigente}
      soloLectura={soloLectura}
      hoy={HOY}
    />,
  );
}

describe("EditorEscalera", () => {
  it("siembra los peldaños vigentes para editarlos", () => {
    montar();
    expect(screen.getByDisplayValue("Bronce")).toBeTruthy();
    expect(screen.getByDisplayValue("Plata")).toBeTruthy();
  });

  it("publica la escalera ENTERA de una vez", () => {
    // No peldaño a peldaño: media escalera publicada sería una escalera vigente.
    montar();
    fireEvent.click(screen.getByRole("button", { name: /publicar escalera/i }));

    return waitFor(() => {
      expect(publicar).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: TENANT,
          vigente_desde: HOY,
          niveles: [
            { nombre: "Bronce", puntaje_min: 60, monto: 100 },
            { nombre: "Plata", puntaje_min: 80, monto: 250 },
          ],
        }),
      );
    });
  });

  it("rechaza dos peldaños con el mismo umbral ANTES de llamar al servidor", () => {
    // El error tiene que decir qué corregir, no volver como un fallo genérico.
    montar();
    const umbrales = screen.getAllByDisplayValue(/^(60|80)$/);
    fireEvent.change(umbrales[1]!, { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: /publicar escalera/i }));

    return waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/mismo puntaje/i);
      expect(publicar).not.toHaveBeenCalled();
    });
  });

  it("un nivel sin nombre no se publica", () => {
    montar();
    fireEvent.change(screen.getByDisplayValue("Bronce"), {
      target: { value: "  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /publicar escalera/i }));
    return waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(publicar).not.toHaveBeenCalled();
    });
  });

  it("añade y quita peldaños, y nunca deja la escalera vacía", () => {
    montar(false, [VIGENTE[0]!]);
    // Con un solo peldaño, el botón de quitar está deshabilitado.
    const quitar = screen.getByRole("button", { name: /quitar el nivel/i });
    expect(quitar.hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /añadir nivel/i }));
    expect(
      screen.getAllByRole("button", { name: /quitar el nivel/i }),
    ).toHaveLength(2);
  });

  it("el error del servidor se anuncia como alerta", () => {
    publicar.mockResolvedValue({
      ok: false,
      error: "Ya hay una escalera de bonos vigente desde 2026-08-13.",
    });
    montar();
    fireEvent.click(screen.getByRole("button", { name: /publicar escalera/i }));
    return waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /ya hay una escalera/i,
      ),
    );
  });

  it("en modo lectura no hay forma de publicar", () => {
    // Lo que de verdad para al supervisor es la RLS; esto solo evita ofrecerle
    // un botón que terminaría en error.
    montar(true);
    expect(
      screen.queryByRole("button", { name: /publicar escalera/i }),
    ).toBeNull();
    expect(screen.getByText(/desde 60 puntos/i)).toBeTruthy();
  });
});
