import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VisitaEnCola } from "@/lib/panel/revision";

import { ColaRevision } from "./cola-revision";

const { removeChannel, subscribe, canal } = vi.hoisted(() => {
  const subscribe = vi.fn();
  const on = vi.fn();
  const canal = { on, subscribe };
  on.mockReturnValue(canal);
  subscribe.mockReturnValue(canal);
  return { removeChannel: vi.fn(), subscribe, canal };
});

vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => ({
    realtime: { setAuth: () => Promise.resolve() },
    channel: () => canal,
    removeChannel,
  }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function visita(over: Partial<VisitaEnCola> = {}): VisitaEnCola {
  return {
    visita_id: "v1",
    mercaderista_id: "m1",
    mercaderista_nombre: "José Quispe",
    tienda_nombre: "Plaza Vea Surco",
    cadena_nombre: "Plaza Vea",
    check_in_at: "2026-08-03T14:00:00Z",
    check_out_at: "2026-08-03T14:47:00Z",
    duracion_min: 47,
    check_in_geocerca_ok: true,
    check_out_geocerca_ok: true,
    marcas: 2,
    omitidos: 0,
    contingencias: 0,
    quiebres: 1,
    fotos: 4,
    fotos_pendientes: 0,
    decision: null,
    motivo: null,
    revisor_nombre: null,
    revisado_at: null,
    ...over,
  };
}

const PENDIENTE = visita();
const REVISADA = visita({
  visita_id: "v2",
  mercaderista_nombre: "Rosa Meza",
  decision: "aprobada",
  revisor_nombre: "Ana Torres",
  revisado_at: "2026-08-04T10:00:00Z",
});

function pintar(soloPendientes = true, visitas = [PENDIENTE, REVISADA]) {
  return render(
    <ColaRevision visitasIniciales={visitas} soloPendientes={soloPendientes} />,
  );
}

beforeEach(() => {
  removeChannel.mockClear();
});

describe("ColaRevision", () => {
  it("por defecto solo enseña lo que espera decisión", () => {
    pintar(true);
    expect(screen.getByText("José Quispe")).toBeInTheDocument();
    expect(screen.queryByText("Rosa Meza")).not.toBeInTheDocument();
  });

  it("el filtro 'Todas' enseña también las ya revisadas", () => {
    pintar(false);
    expect(screen.getByText("Rosa Meza")).toBeInTheDocument();
    expect(screen.getByText("Aprobada")).toBeInTheDocument();
  });

  it("cuenta las pendientes sobre el total, no sobre lo visible", () => {
    // El contador es el badge de trabajo por hacer: filtrar no lo cambia.
    pintar(true);
    expect(screen.getByText(/1 reporte espera decisión/)).toBeInTheDocument();
  });

  it("el estado no se comunica solo por color", () => {
    pintar(false);
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText("Aprobada")).toBeInTheDocument();
  });

  it("avisa de la evidencia que sigue en el teléfono", () => {
    pintar(true, [visita({ fotos: 4, fotos_pendientes: 2 })]);
    expect(screen.getByText("2 sin subir")).toBeInTheDocument();
  });

  it("con todo subido enseña el recuento, no el aviso", () => {
    pintar(true, [visita({ fotos: 4, fotos_pendientes: 0 })]);
    expect(screen.getByText("4 fotos")).toBeInTheDocument();
    expect(screen.queryByText(/sin subir/)).not.toBeInTheDocument();
  });

  it("cada fila enlaza a su detalle", () => {
    pintar(true);
    expect(screen.getByRole("link", { name: "José Quispe" })).toHaveAttribute(
      "href",
      "/supervisor/revision/v1",
    );
  });

  it("una cola vacía lo dice en vez de una tabla en blanco", () => {
    pintar(true, []);
    expect(screen.getByText(/No hay reportes por revisar/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("marca el filtro activo para un lector de pantalla", () => {
    pintar(true);
    expect(screen.getByRole("link", { name: "Por revisar" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Todas" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("al desmontar suelta el canal de Realtime", async () => {
    // Sin esto, navegar entre secciones va dejando suscripciones abiertas.
    const { unmount } = pintar(true);
    // La suscripción se monta en una promesa: se deja resolver antes de soltar.
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalled());

    unmount();

    await vi.waitFor(() => expect(removeChannel).toHaveBeenCalledWith(canal));
  });
});
