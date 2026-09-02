import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

import type { MarcaAuditable } from "@/lib/levantamiento";
import { PASOS } from "@/lib/pasos-levantamiento";
import type { ModuloDelMenu, ProgresoModulo } from "@/lib/progreso-visita";

import { MenuVisita } from "./menu-visita";

// El menú es la pantalla que hace posible la navegación libre: enseña TODOS los
// módulos y su estado por marca, y deja entrar a cualquiera. Es presentacional,
// así que se prueba sin réplica ni navegación.

const marca = (id: string, nombre: string): MarcaAuditable => ({
  id,
  nombre,
  logo_url: null,
  levantamiento_id: `lev-${id}`,
  levantamiento_estado: "en_curso",
});

const OSTER = marca("m1", "Oster");
const SHARPIE = marca("m2", "Sharpie");

const modulo = (
  idPaso: string,
  entradas: { marca: MarcaAuditable; progreso: ProgresoModulo }[],
): ModuloDelMenu => {
  const paso = PASOS.find((p) => p.id === idPaso);
  if (!paso) throw new Error(`paso desconocido: ${idPaso}`);
  return { modulo: paso, marcas: entradas };
};

const unaMarcaPendiente = (idPaso: string) =>
  modulo(idPaso, [{ marca: OSTER, progreso: { estado: "pendiente" } }]);

describe("MenuVisita", () => {
  it("pinta un módulo por cada paso, no solo el siguiente pendiente", async () => {
    // El giro del ticket: antes solo se veía el paso activo, y por eso no se
    // podía saltar.
    await render(
      <MenuVisita
        modulos={PASOS.map((p) => unaMarcaPendiente(p.id))}
        cargando={false}
        todoListo={false}
        onAbrir={jest.fn()}
        onCheckOut={jest.fn()}
      />,
    );

    for (const paso of PASOS) {
      expect(screen.getByText(paso.titulo)).toBeTruthy();
    }
  });

  it("el estado se lee como TEXTO, no solo por el color del punto", async () => {
    await render(
      <MenuVisita
        modulos={[
          modulo("antes", [
            { marca: OSTER, progreso: { estado: "completado" } },
          ]),
          modulo("quiebres", [
            { marca: OSTER, progreso: { estado: "omitido" } },
          ]),
          modulo("precios", [
            { marca: OSTER, progreso: { estado: "pendiente" } },
          ]),
        ]}
        cargando={false}
        todoListo={false}
        onAbrir={jest.fn()}
        onCheckOut={jest.fn()}
      />,
    );

    expect(screen.getByText("Listo")).toBeTruthy();
    expect(screen.getByText("Omitido")).toBeTruthy();
    expect(screen.getByText("Pendiente")).toBeTruthy();
  });

  it("un módulo muestra el estado de CADA marca por separado", async () => {
    // "Sigo en el módulo de exhibición, pero tengo que cambiar la marca": el
    // menú tiene que dejar ver en cuáles falta.
    await render(
      <MenuVisita
        modulos={[
          modulo("exhibiciones", [
            { marca: OSTER, progreso: { estado: "completado" } },
            { marca: SHARPIE, progreso: { estado: "pendiente" } },
          ]),
        ]}
        cargando={false}
        todoListo={false}
        onAbrir={jest.fn()}
        onCheckOut={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Exhibiciones, Oster, Listo" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Exhibiciones, Sharpie, Pendiente" }),
    ).toBeTruthy();
  });

  it("tocar una marca dentro de un módulo abre ESE módulo con ESA marca", async () => {
    const onAbrir = jest.fn();
    await render(
      <MenuVisita
        modulos={[
          modulo("exhibiciones", [
            { marca: OSTER, progreso: { estado: "pendiente" } },
            { marca: SHARPIE, progreso: { estado: "pendiente" } },
          ]),
        ]}
        cargando={false}
        todoListo={false}
        onAbrir={onAbrir}
        onCheckOut={jest.fn()}
      />,
    );

    await fireEvent.press(
      screen.getByRole("button", { name: "Exhibiciones, Sharpie, Pendiente" }),
    );

    expect(onAbrir).toHaveBeenCalledWith("exhibiciones", "m2");
  });

  it("el motivo del bypass sigue a la vista aunque el módulo ya esté completado", async () => {
    // El mercaderista vuelve a la trastienda al final del turno y la termina: el
    // módulo queda "Listo", pero el porqué de la vuelta no se borra.
    await render(
      <MenuVisita
        modulos={[
          modulo("quiebres", [
            {
              marca: OSTER,
              progreso: {
                estado: "completado",
                motivoOmision: "No me dejaban entrar a la trastienda",
              },
            },
          ]),
        ]}
        cargando={false}
        todoListo={false}
        onAbrir={jest.fn()}
        onCheckOut={jest.fn()}
      />,
    );

    expect(screen.getByText("Listo")).toBeTruthy();
    expect(
      screen.getByText("Oster: No me dejaban entrar a la trastienda"),
    ).toBeTruthy();
  });

  it("el check-out solo se ofrece cuando todo está cerrado", async () => {
    const onCheckOut = jest.fn();
    await render(
      <MenuVisita
        modulos={[unaMarcaPendiente("antes")]}
        cargando={false}
        todoListo={false}
        onAbrir={jest.fn()}
        onCheckOut={onCheckOut}
      />,
    );

    expect(screen.queryByText("Ir al check-out")).toBeNull();
  });

  it("con todo cerrado, el check-out está a un toque", async () => {
    const onCheckOut = jest.fn();
    await render(
      <MenuVisita
        modulos={[
          modulo("antes", [
            { marca: OSTER, progreso: { estado: "completado" } },
          ]),
        ]}
        cargando={false}
        todoListo={true}
        onAbrir={jest.fn()}
        onCheckOut={onCheckOut}
      />,
    );

    await fireEvent.press(
      screen.getByRole("button", { name: "Ir al check-out" }),
    );
    expect(onCheckOut).toHaveBeenCalled();
  });

  it("mientras carga no pinta módulos vacíos que el mercaderista tocaría dos veces", async () => {
    await render(
      <MenuVisita
        modulos={[]}
        cargando={true}
        todoListo={false}
        onAbrir={jest.fn()}
        onCheckOut={jest.fn()}
      />,
    );

    expect(screen.getByText("Cargando los módulos de la visita…")).toBeTruthy();
    expect(screen.queryByText("Sin marcas por auditar")).toBeNull();
  });

  it("sin marcas por auditar lo dice, en vez de dejar la pantalla en blanco", async () => {
    await render(
      <MenuVisita
        modulos={[]}
        cargando={false}
        todoListo={false}
        onAbrir={jest.fn()}
        onCheckOut={jest.fn()}
      />,
    );

    expect(screen.getByText("Sin marcas por auditar")).toBeTruthy();
  });

  // Control negativo del ARNÉS: si el árbol viniese vacío, todas las aserciones
  // negativas de arriba pasarían en falso y esta se cae.
  it("el arnés monta un árbol real: una consulta imposible falla", async () => {
    await render(
      <MenuVisita
        modulos={[unaMarcaPendiente("antes")]}
        cargando={false}
        todoListo={false}
        onAbrir={jest.fn()}
        onCheckOut={jest.fn()}
      />,
    );

    expect(screen.getByText("Antes y Share of Shelf")).toBeTruthy();
    expect(() =>
      screen.getByText("un texto que el menú nunca pinta"),
    ).toThrow();
  });
});
