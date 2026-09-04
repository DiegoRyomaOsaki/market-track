import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

import type * as RN from "react-native";

import type * as LibIncidencias from "@/lib/incidencias";

// La cámara, el GPS y la escritura a la réplica no existen en Jest. Se sustituyen
// por dobles que dejan ver lo único que decide este componente: qué se guarda y
// cuándo se deja guardar.
jest.mock("@powersync/react-native", () => ({ useQuery: jest.fn() }));
jest.mock("@/lib/powersync/db", () => ({ db: {} }));
jest.mock("@/lib/cola-fotos-instancia", () => ({ encolarFoto: jest.fn() }));
jest.mock("@/lib/ubicacion", () => ({
  ubicacionActual: () =>
    Promise.resolve({ ok: true, punto: { lat: -12.1, lng: -77.03 } }),
}));
jest.mock("@/lib/incidencias", () => {
  const real = jest.requireActual<typeof LibIncidencias>("@/lib/incidencias");
  return {
    ...real,
    resolverIncidencia: jest.fn(() => Promise.resolve()),
    noPuedoResolver: jest.fn(() => Promise.resolve()),
  };
});
jest.mock("@/componentes/camara-foto", () => {
  const { Pressable, Text } = jest.requireActual<typeof RN>("react-native");
  return {
    CamaraFoto: (p: { onListo: (f: unknown) => void }) => (
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          p.onListo({
            ruta: "file:///cache/foto.jpg",
            hash: "sha-1",
            capturada_at: "2026-09-04T12:00:00.000Z",
            geo: { lat: -12.1, lng: -77.03 },
          })
        }
      >
        <Text>disparar la camara</Text>
      </Pressable>
    ),
  };
});

import {
  type IncidenciaLocal,
  noPuedoResolver,
  resolverIncidencia,
} from "@/lib/incidencias";

import { ResolverIncidencia } from "./resolver-incidencia";

const mockResolver = jest.mocked(resolverIncidencia);
const mockNoPuedo = jest.mocked(noPuedoResolver);

const INCIDENCIA: IncidenciaLocal = {
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
};

function pintar(props: Partial<Parameters<typeof ResolverIncidencia>[0]> = {}) {
  return render(
    <ResolverIncidencia
      incidencia={INCIDENCIA}
      visible={true}
      tenantId="t1"
      usuario="jose@markettrack.pe"
      onAtendida={jest.fn()}
      onCancelar={jest.fn()}
      {...props}
    />,
  );
}

/** Elige una frase enlatada y toma la foto: el camino feliz completo. */
async function completarResolucion() {
  await fireEvent.press(screen.getByText("Cambié el precio en góndola"));
  await fireEvent.press(
    screen.getByRole("button", { name: "Tomar la foto del después" }),
  );
  await fireEvent.press(screen.getByText("disparar la camara"));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ResolverIncidencia", () => {
  it("enseña de qué incidencia se trata, con sus números", async () => {
    await pintar();
    expect(screen.getByText("Licuadora X")).toBeTruthy();
    expect(screen.getByText(/20 en sistema/)).toBeTruthy();
  });

  it("sin acción ni foto, no deja resolver", async () => {
    await pintar();
    await fireEvent.press(
      screen.getByRole("button", { name: "Marcar resuelta" }),
    );
    expect(mockResolver).not.toHaveBeenCalled();
  });

  it("con acción pero SIN foto, sigue sin dejar", async () => {
    // "Y tomas la foto final, porque hay un antes y un después."
    await pintar();
    await fireEvent.press(screen.getByText("Cambié el precio en góndola"));
    await fireEvent.press(
      screen.getByRole("button", { name: "Marcar resuelta" }),
    );
    expect(mockResolver).not.toHaveBeenCalled();
    expect(screen.getByText(/La foto es obligatoria/)).toBeTruthy();
  });

  it("elegir una frase la mete en el campo, y sigue siendo editable", async () => {
    // El criterio pide "opciones tipificadas + texto libre cuando se sale de las
    // opciones": la frase es un punto de partida, no una jaula.
    await pintar();
    await fireEvent.press(screen.getByText("Cambié el precio en góndola"));

    const campo = screen.getByLabelText("Acción tomada");
    expect(campo.props.value).toBe("Cambié el precio en góndola");

    await fireEvent.changeText(campo, "Cambié el precio y avisé al encargado");
    expect(screen.getByLabelText("Acción tomada").props.value).toBe(
      "Cambié el precio y avisé al encargado",
    );
  });

  it("con acción y foto, resuelve con lo que el mercaderista escribió", async () => {
    const onAtendida = jest.fn();
    await pintar({ onAtendida });
    await completarResolucion();

    await fireEvent.press(
      screen.getByRole("button", { name: "Marcar resuelta" }),
    );

    expect(mockResolver).toHaveBeenCalledWith(
      expect.objectContaining({
        incidenciaId: "i1",
        visitaId: "v1",
        accionTomada: "Cambié el precio en góndola",
      }),
    );
    expect(onAtendida).toHaveBeenCalled();
  });

  it("un fallo al guardar deja el mensaje a la vista y NO cierra", async () => {
    // Si se cerrara, el mercaderista creería que quedó guardado y la incidencia
    // seguiría pendiente sin que él lo supiera.
    const onAtendida = jest.fn();
    mockResolver.mockRejectedValueOnce(new Error("la réplica está bloqueada"));
    await pintar({ onAtendida });
    await completarResolucion();

    await fireEvent.press(
      screen.getByRole("button", { name: "Marcar resuelta" }),
    );

    expect(screen.getByText("la réplica está bloqueada")).toBeTruthy();
    expect(onAtendida).not.toHaveBeenCalled();
  });

  it("«no puedo resolverla» sin motivo no guarda nada", async () => {
    await pintar();
    await fireEvent.press(
      screen.getByRole("button", { name: "No puedo resolverla" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Guardar la observación" }),
    );
    expect(mockNoPuedo).not.toHaveBeenCalled();
  });

  it("«no puedo resolverla» con motivo la deja atendida con observación", async () => {
    const onAtendida = jest.fn();
    await pintar({ onAtendida });
    await fireEvent.press(
      screen.getByRole("button", { name: "No puedo resolverla" }),
    );
    await fireEvent.changeText(
      screen.getByLabelText("Motivo"),
      "El encargado no autorizó tocar la góndola",
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Guardar la observación" }),
    );

    expect(mockNoPuedo).toHaveBeenCalledWith({
      incidenciaId: "i1",
      motivo: "El encargado no autorizó tocar la góndola",
    });
    expect(onAtendida).toHaveBeenCalled();
  });

  it("avisa de que la observación no la hace desaparecer de la lista", async () => {
    await pintar();
    await fireEvent.press(
      screen.getByRole("button", { name: "No puedo resolverla" }),
    );
    expect(screen.getByText(/no desaparece de la lista/)).toBeTruthy();
  });

  it("el arnés monta un árbol real: una consulta imposible falla", async () => {
    await pintar();
    expect(screen.getByText("Licuadora X")).toBeTruthy();
    expect(() =>
      screen.getByText("un texto que el modal nunca pinta"),
    ).toThrow();
  });
});
