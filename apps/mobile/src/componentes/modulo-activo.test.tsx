import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

import type * as RN from "react-native";

import type { MarcaAuditable } from "@/lib/levantamiento";
import { PASOS, type PasoWizard } from "@/lib/pasos-levantamiento";

// Los seis componentes de paso y el modal de contingencia tocan cámara, GPS,
// réplica nativa y cola de fotos: nada de eso existe en Jest. Se sustituyen por
// dobles que sí dejan ver LO ÚNICO que decide este componente — a qué marca se
// le atribuye el trabajo y el bypass.
//
// Es el fallo más caro de la pantalla: pasar el `levantamiento_id` de otra marca
// no rompe nada visible, atribuye el trabajo (o la alerta al supervisor) a la
// marca equivocada, y nadie se entera.

jest.mock("@/componentes/paso-antes-sos", () => {
  const { Text } = jest.requireActual<typeof RN>("react-native");
  return {
    PasoAntesSos: (p: { levantamientoId: string }) => (
      <Text>{`paso antes de ${p.levantamientoId}`}</Text>
    ),
  };
});
jest.mock("@/componentes/paso-quiebres", () => {
  const { Text } = jest.requireActual<typeof RN>("react-native");
  return {
    PasoQuiebres: (p: { levantamientoId: string }) => (
      <Text>{`paso quiebres de ${p.levantamientoId}`}</Text>
    ),
  };
});
jest.mock("@/componentes/paso-precios", () => {
  const { Text } = jest.requireActual<typeof RN>("react-native");
  return {
    PasoPrecios: (p: { levantamientoId: string }) => (
      <Text>{`paso precios de ${p.levantamientoId}`}</Text>
    ),
  };
});
jest.mock("@/componentes/paso-exhibiciones", () => {
  const { Pressable, Text } = jest.requireActual<typeof RN>("react-native");
  return {
    PasoExhibiciones: (p: {
      levantamientoId: string;
      onCompletar: () => void;
    }) => (
      <Pressable accessibilityRole="button" onPress={p.onCompletar}>
        <Text>{`paso exhibiciones de ${p.levantamientoId}`}</Text>
      </Pressable>
    ),
  };
});
jest.mock("@/componentes/paso-despues", () => {
  const { Text } = jest.requireActual<typeof RN>("react-native");
  return {
    PasoDespues: (p: { levantamientoId: string }) => (
      <Text>{`paso despues de ${p.levantamientoId}`}</Text>
    ),
  };
});
jest.mock("@/componentes/paso-configurable", () => {
  const { Text } = jest.requireActual<typeof RN>("react-native");
  return {
    PasoConfigurable: (p: { levantamientoId: string }) => (
      <Text>{`paso configurable de ${p.levantamientoId}`}</Text>
    ),
  };
});
jest.mock("@/componentes/contingencia-modal", () => {
  const { Text } = jest.requireActual<typeof RN>("react-native");
  return {
    ContingenciaModal: (p: {
      paso: string;
      pasoConfigId: string | null;
      levantamiento_id: string;
    }) => (
      <Text>
        {`contingencia ${p.paso}/${p.pasoConfigId ?? "-"} en ${p.levantamiento_id}`}
      </Text>
    ),
  };
});

import { ModuloActivo } from "./modulo-activo";

const marca = (id: string, nombre: string, lev: string): MarcaAuditable => ({
  id,
  nombre,
  logo_url: null,
  levantamiento_id: lev,
  levantamiento_estado: "en_curso",
});

const OSTER = marca("m1", "Oster", "lev-oster");
const SHARPIE = marca("m2", "Sharpie", "lev-sharpie");
const MARCAS = [OSTER, SHARPIE];

const pasoFijo = (id: string): PasoWizard => {
  const p = PASOS.find((x) => x.id === id);
  if (!p) throw new Error(`paso desconocido: ${id}`);
  return p;
};

function pintar(props: Partial<Parameters<typeof ModuloActivo>[0]> = {}) {
  return render(
    <ModuloActivo
      modulo={pasoFijo("exhibiciones")}
      marcas={MARCAS}
      marcaId="m1"
      progreso={{ estado: "pendiente" }}
      visitaId="v1"
      tenantId="t1"
      usuario="jose@markettrack.pe"
      onCambiarMarca={jest.fn()}
      onCompletar={jest.fn()}
      onVolver={jest.fn()}
      {...props}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ModuloActivo", () => {
  it("abre el módulo pedido aunque los anteriores sigan pendientes", async () => {
    // El corazón del ticket: ya no hay "paso activo", hay el que el
    // mercaderista eligió. Antes esto era imposible por construcción.
    await pintar({ modulo: pasoFijo("exhibiciones") });

    expect(screen.getByText("paso exhibiciones de lev-oster")).toBeTruthy();
    expect(screen.queryByText("paso antes de lev-oster")).toBeNull();
  });

  it("el paso recibe el levantamiento de la MARCA seleccionada", async () => {
    await pintar({ marcaId: "m2" });

    expect(screen.getByText("paso exhibiciones de lev-sharpie")).toBeTruthy();
  });

  it("cambiar de marca no saca del módulo", async () => {
    // "Sigo en el módulo de exhibición, pero tengo que cambiar la marca."
    const onCambiarMarca = jest.fn();
    await pintar({ onCambiarMarca });

    await fireEvent.press(
      screen.getByRole("button", { name: "Marca Sharpie" }),
    );

    expect(onCambiarMarca).toHaveBeenCalledWith("m2");
    // El módulo sigue siendo el mismo: el cambio de marca no navega.
    expect(screen.getByText("Exhibiciones")).toBeTruthy();
  });

  it("completar avisa con el levantamiento de la marca seleccionada, no con otro", async () => {
    // El fallo silencioso #1: con el id de otra marca, el módulo se daría por
    // cerrado en la marca equivocada y el mercaderista no vería nada raro.
    const onCompletar = jest.fn();
    await pintar({ marcaId: "m2", onCompletar });

    await fireEvent.press(
      screen.getByRole("button", { name: "paso exhibiciones de lev-sharpie" }),
    );

    expect(onCompletar).toHaveBeenCalledWith("lev-sharpie");
  });

  it("la contingencia se registra contra el levantamiento de la marca seleccionada", async () => {
    // El fallo silencioso #2: el bypass atribuido a otra marca manda al
    // supervisor una alerta con la marca equivocada.
    await pintar({ marcaId: "m2" });

    expect(
      screen.getByText("contingencia exhibiciones/- en lev-sharpie"),
    ).toBeTruthy();
  });

  it("la contingencia de un módulo configurable lleva su id además del enum", async () => {
    // Todos los pasos configurables comparten `campos_extra`: sin
    // `paso_config_id` no se sabría cuál se omitió.
    const configurable: PasoWizard = {
      tipo: "configurable",
      id: "extra_uno",
      titulo: "Extra uno",
      descripcion: "",
      paso: "campos_extra",
      campos: [],
    };
    await pintar({ modulo: configurable });

    expect(
      screen.getByText("contingencia campos_extra/extra_uno en lev-oster"),
    ).toBeTruthy();
  });

  it("un módulo ya omitido no vuelve a ofrecer el bypass", async () => {
    // Con navegación libre se puede reabrir lo omitido, y una segunda
    // contingencia mandaría una alerta duplicada al supervisor. La tabla no
    // tiene ninguna verja: la verja es esta.
    await pintar({
      progreso: { estado: "omitido", motivoOmision: "Góndola en remodelación" },
    });

    expect(screen.queryByText(/^contingencia /)).toBeNull();
    expect(
      screen.getByText("Se omitió antes: Góndola en remodelación"),
    ).toBeTruthy();
  });

  it("volver deja el módulo sin cerrar: es el menú quien decide", async () => {
    const onVolver = jest.fn();
    await pintar({ onVolver });

    await fireEvent.press(screen.getByRole("button", { name: "‹ Módulos" }));

    expect(onVolver).toHaveBeenCalled();
  });

  it("una marca sin levantamiento todavía no pinta el paso contra un id vacío", async () => {
    // Si el levantamiento aún no se creó, pintar el paso con `null` haría que lo
    // capturado colgase de la nada.
    await pintar({
      marcas: [{ ...OSTER, levantamiento_id: null }],
      marcaId: "m1",
    });

    expect(screen.getByText("Preparando la marca…")).toBeTruthy();
    expect(screen.queryByText(/^paso exhibiciones/)).toBeNull();
  });

  // Control negativo del ARNÉS: un árbol vacío haría pasar en falso a las
  // aserciones negativas de arriba.
  it("el arnés monta un árbol real: una consulta imposible falla", async () => {
    await pintar();

    expect(screen.getByText("Exhibiciones")).toBeTruthy();
    expect(() =>
      screen.getByText("un texto que el módulo nunca pinta"),
    ).toThrow();
  });
});
