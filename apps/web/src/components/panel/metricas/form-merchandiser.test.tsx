import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FormMerchandiser } from "./form-merchandiser";

const publicar = vi.fn<(datos: unknown) => Promise<unknown>>();
const previsualizar =
  vi.fn<(tenant: string, pesos: unknown) => Promise<unknown>>();
vi.mock("@/lib/metricas/acciones", () => ({
  publicarConfigMerchandiser: (d: unknown): Promise<unknown> => publicar(d),
  previsualizarMerchandiser: (t: string, p: unknown): Promise<unknown> =>
    previsualizar(t, p),
}));

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";

const VIGENTE = {
  id: "c1",
  peso_puntualidad: 40,
  peso_asistencia: 20,
  peso_tiempo_efectivo: 0,
  peso_calidad: 30,
  peso_herramientas: 10,
  tolerancia_puntualidad_min: 20,
  minutos_tardanza_cero: 90,
  dias_gracia_cierre: 14,
  periodicidad: "trimestral" as const,
  vigente_desde: "2026-01-01",
};

beforeEach(() => {
  publicar.mockReset();
  publicar.mockResolvedValue({ ok: true });
  previsualizar.mockReset();
  previsualizar.mockResolvedValue({ ok: true, previa: null });
});

/** Un peso por su etiqueta: varios comparten valor, la etiqueta es única. */
function peso(etiqueta: string): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(etiqueta);
}

function campoPorEtiqueta(etiqueta: RegExp): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(etiqueta);
}

function montar(soloLectura = false, vigente = null as typeof VIGENTE | null) {
  render(
    <FormMerchandiser
      tenantId={TENANT}
      vigente={vigente}
      soloLectura={soloLectura}
      hoy="2026-08-13"
    />,
  );
}

describe("FormMerchandiser", () => {
  it("siembra el formulario con la configuración vigente", () => {
    // Publicar una versión nueva parte de la que rige, no de los defaults: si
    // no, el admin que solo quiere cambiar un peso pierde los demás sin verlo.
    // Se busca por ETIQUETA y no por valor: varios pesos comparten número.
    montar(false, VIGENTE);
    expect(peso("Puntualidad").value).toBe("40");
    expect(peso("Asistencia").value).toBe("20");
    expect(campoPorEtiqueta(/tardanza que da 0/i).value).toBe("90");
    expect(campoPorEtiqueta(/días de gracia/i).value).toBe("14");
  });

  it("el peso del tiempo efectivo llega deshabilitado y en 0", () => {
    // La variable no tiene fórmula acordada y la base fija su peso en 0 con un
    // CHECK: ofrecer el control sería ofrecer un clic que termina en error.
    montar();
    const tiempoEfectivo = peso("Tiempo efectivo de atención");
    expect(tiempoEfectivo.value).toBe("0");
    expect(tiempoEfectivo.disabled).toBe(true);
  });

  it("se muestra pero NO se oculta: el admin tiene que saber que existe", () => {
    montar();
    expect(screen.getByText("Tiempo efectivo de atención")).toBeTruthy();
    expect(screen.getByText(/todavía no se puntúa/i)).toBeTruthy();
  });

  it("publica la configuración con la periodicidad elegida", () => {
    montar();
    fireEvent.change(screen.getByDisplayValue("Mensual"), {
      target: { value: "anual" },
    });
    fireEvent.click(screen.getByRole("button", { name: /publicar versión/i }));

    return waitFor(() =>
      expect(publicar).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: TENANT,
          periodicidad: "anual",
          peso_tiempo_efectivo: 0,
        }),
      ),
    );
  });

  it("unos pesos que no suman 100 no llegan al servidor", () => {
    montar();
    fireEvent.change(peso("Puntualidad"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: /publicar versión/i }));

    return waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/sumar 100/i);
      expect(publicar).not.toHaveBeenCalled();
    });
  });

  it("una rampa invertida se explica antes de enviar", () => {
    // La tolerancia por encima del tope de tardanza dejaría la recta al revés.
    montar();
    fireEvent.change(campoPorEtiqueta(/tardanza que da 0/i), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: /publicar versión/i }));

    return waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(
        /mayor que la tolerancia/i,
      );
      expect(publicar).not.toHaveBeenCalled();
    });
  });

  it("tras un error el foco va al campo que hay que corregir", () => {
    // Si se quedara en el botón, quien navega con teclado tendría que buscar a
    // mano dónde estaba el problema.
    montar();
    const primerPeso = peso("Puntualidad");
    fireEvent.change(primerPeso, { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: /publicar versión/i }));

    return waitFor(() => expect(document.activeElement).toBe(primerPeso));
  });

  it("en modo lectura no se puede publicar ni editar", () => {
    montar(true);
    expect(
      screen.queryByRole("button", { name: /publicar versión/i }),
    ).toBeNull();
    const fieldset = peso("Puntualidad").closest("fieldset");
    expect(fieldset?.hasAttribute("disabled")).toBe(true);
  });
});
