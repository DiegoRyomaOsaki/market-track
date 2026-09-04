import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

// `lib/incidencias` trae los hooks que leen la réplica junto a las funciones
// puras que este componente usa. Nada de eso existe en Jest, y la lista no lo
// necesita: es presentacional.
jest.mock("@powersync/react-native", () => ({ useQuery: jest.fn() }));
jest.mock("@/lib/powersync/db", () => ({ db: {} }));
jest.mock("@/lib/cola-fotos-instancia", () => ({ encolarFoto: jest.fn() }));

import type { IncidenciaLocal } from "@/lib/incidencias";

import { ListaIncidencias } from "./lista-incidencias";

// La lista es presentacional, así que se prueba sin réplica ni navegación. Lo
// que más importa aquí es el VACÍO: la incidencia nace de un cálculo del
// servidor, así que sin señal la lista llega vacía aunque el mercaderista acabe
// de levantar un quiebre. Un "no tienes incidencias" le haría saltarse trabajo.

const incidencia = (p: Partial<IncidenciaLocal> = {}): IncidenciaLocal => ({
  id: "i1",
  visita_id: "v1",
  levantamiento_id: "lev-oster",
  marca_id: "m1",
  marca_nombre: "Oster",
  sku_nombre: "Licuadora X",
  origen: "quiebre",
  estado: "pendiente",
  detalle: JSON.stringify({ stock_sistema: 20, stock_piso: 0 }),
  accion_tomada: null,
  motivo: null,
  creado_at: "2026-09-04T12:00:00.000Z",
  ...p,
});

function pintar(props: Partial<Parameters<typeof ListaIncidencias>[0]> = {}) {
  return render(
    <ListaIncidencias
      incidencias={[incidencia()]}
      cargando={false}
      error={null}
      conectado={true}
      onResolver={jest.fn()}
      onVolver={jest.fn()}
      {...props}
    />,
  );
}

describe("ListaIncidencias", () => {
  it("agrupa por marca", async () => {
    await pintar({
      incidencias: [
        incidencia({ id: "a", marca_id: "m1", marca_nombre: "Oster" }),
        incidencia({ id: "b", marca_id: "m2", marca_nombre: "Sharpie" }),
      ],
    });

    expect(screen.getByText("Oster")).toBeTruthy();
    expect(screen.getByText("Sharpie")).toBeTruthy();
  });

  it("pinta los números del hallazgo, que el motor ya calculó", async () => {
    await pintar();
    expect(screen.getByText(/20 en sistema/)).toBeTruthy();
  });

  it("el estado se lee como TEXTO, no solo por color", async () => {
    await pintar();
    expect(screen.getByText("Pendiente")).toBeTruthy();
  });

  it("tocar una pendiente la manda a resolver, con SU id", async () => {
    const onResolver = jest.fn();
    await pintar({
      incidencias: [incidencia({ id: "la-mia", sku_nombre: "Licuadora X" })],
      onResolver,
    });

    await fireEvent.press(
      screen.getByRole("button", { name: "Licuadora X, Pendiente" }),
    );

    expect(onResolver).toHaveBeenCalledWith(
      expect.objectContaining({ id: "la-mia" }),
    );
  });

  it("una atendida con observación SIGUE en la lista, con su motivo", async () => {
    // No desaparece: el supervisor necesita ver que se miró y por qué quedó así.
    await pintar({
      incidencias: [
        incidencia({
          estado: "no_resuelta",
          motivo: "El encargado no autorizó tocar la góndola",
        }),
      ],
    });

    expect(screen.getByText("Atendida con observación")).toBeTruthy();
    expect(
      screen.getByText("Motivo: El encargado no autorizó tocar la góndola"),
    ).toBeTruthy();
  });

  it("una resuelta muestra la acción que se tomó", async () => {
    await pintar({
      incidencias: [
        incidencia({ estado: "resuelta", accion_tomada: "Repuse 12 unidades" }),
      ],
    });
    expect(screen.getByText("Acción: Repuse 12 unidades")).toBeTruthy();
  });

  it("mientras carga no pinta el vacío", async () => {
    await pintar({ incidencias: [], cargando: true });
    expect(screen.getByText("Cargando las incidencias…")).toBeTruthy();
    expect(screen.queryByText("Nada que atender por ahora")).toBeNull();
  });

  it("si la consulta local falla lo dice, en vez de fingir que no hay nada", async () => {
    await pintar({ incidencias: [], error: "no such table: incidencia" });
    expect(screen.getByText("No se pudo leer la lista")).toBeTruthy();
    expect(screen.queryByText("Nada que atender por ahora")).toBeNull();
  });

  it("vacío y conectado: puede decir que no hay nada que atender", async () => {
    await pintar({ incidencias: [], conectado: true });
    expect(screen.getByText("Nada que atender por ahora")).toBeTruthy();
  });

  // El caso que protege del hueco de la derivación offline: sin señal la lista
  // está vacía porque la incidencia se calcula en el servidor, no porque no
  // haya hallazgos.
  it("vacío y SIN conexión: avisa de que la lista puede estar incompleta", async () => {
    await pintar({ incidencias: [], conectado: false });
    expect(screen.getByText("Sin conexión")).toBeTruthy();
    expect(screen.getByText(/puede estar incompleta/)).toBeTruthy();
    expect(screen.queryByText("Nada que atender por ahora")).toBeNull();
  });

  it("el arnés monta un árbol real: una consulta imposible falla", async () => {
    await pintar();
    expect(screen.getByText("Incidencias")).toBeTruthy();
    expect(() =>
      screen.getByText("un texto que la lista nunca pinta"),
    ).toThrow();
  });
});
