import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DiaPlaneado } from "@/lib/panel/ruteros";

import { DiaRutero } from "./dia-rutero";

const acciones = vi.hoisted(() => ({
  agregarParada: vi.fn(),
  fijarHoraParada: vi.fn(),
  duplicarPeriodo: vi.fn(),
  publicarRutero: vi.fn(),
  quitarParada: vi.fn(),
  reordenarParadas: vi.fn(),
}));

vi.mock("@/lib/panel/acciones-ruteros", () => acciones);

const TIENDAS = [
  { id: "t1", nombre: "Plaza Vea Surco" },
  { id: "t2", nombre: "Tottus Angamos" },
];

function dia(over: Partial<DiaPlaneado> = {}): DiaPlaneado {
  return {
    fecha: "2026-08-03",
    ruteroId: "r1",
    estado: "borrador",
    paradas: [
      {
        id: "a",
        orden: 1,
        tiendaId: "t1",
        tiendaNombre: "Plaza Vea Surco",
        hora: null,
      },
      {
        id: "b",
        orden: 2,
        tiendaId: "t2",
        tiendaNombre: "Tottus Angamos",
        hora: null,
      },
    ],
    ...over,
  };
}

function pintar(d: DiaPlaneado, compacto = false) {
  return render(
    <DiaRutero
      dia={d}
      mercaderistaId="m1"
      tiendas={TIENDAS}
      compacto={compacto}
    />,
  );
}

/** El `<select>` de tiendas: hay más de un combobox en la pantalla completa. */
function selectorDeTienda() {
  return screen.getByRole("combobox", { name: /Añadir tienda/ });
}

beforeEach(() => {
  for (const fn of Object.values(acciones)) fn.mockReset();
});

describe("DiaRutero", () => {
  it("lista las paradas en orden y numeradas", () => {
    pintar(dia());
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Plaza Vea Surco");
    expect(items[1]).toHaveTextContent("Tottus Angamos");
  });

  it("subir manda la lista COMPLETA en el orden nuevo", async () => {
    // Se manda la lista entera y no "sube esta una posición": dos supervisores
    // con operaciones relativas sobre el mismo rutero se pisarían.
    acciones.reordenarParadas.mockResolvedValue({ ok: true });
    pintar(dia());

    fireEvent.click(screen.getByRole("button", { name: /Subir Tottus/ }));

    await waitFor(() =>
      expect(acciones.reordenarParadas).toHaveBeenCalledWith({
        ruteroId: "r1",
        paradas: ["b", "a"],
      }),
    );
  });

  it("en los extremos los botones de orden se anuncian no disponibles PERO siguen enfocables", () => {
    // `aria-disabled` y no `disabled`: al subir la segunda parada, esta pasa a
    // primera y su propio botón se desactivaría — el navegador quita el foco de un
    // elemento recién deshabilitado y lo manda a `<body>`, dejando sin sitio a
    // quien navega con teclado justo después de actuar.
    pintar(dia());
    const subirPrimera = screen.getByRole("button", {
      name: /Subir Plaza Vea/,
    });
    expect(subirPrimera).toHaveAttribute("aria-disabled", "true");
    expect(subirPrimera).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Bajar Tottus/ }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("un botón inactivo no reordena aunque se pulse", () => {
    pintar(dia());
    fireEvent.click(screen.getByRole("button", { name: /Subir Plaza Vea/ }));
    expect(acciones.reordenarParadas).not.toHaveBeenCalled();
  });

  it("cada botón dice QUÉ parada mueve, no solo la flecha", () => {
    // El símbolo es decorativo: con un lector de pantalla, seis botones "↑" en
    // una lista no dicen nada.
    pintar(dia());
    expect(
      screen.getByRole("button", { name: "Bajar Plaza Vea Surco" }),
    ).toBeInTheDocument();
  });

  it("elegir una tienda NO la añade: hace falta confirmar", async () => {
    // Un `<select>` cerrado emite `change` en cada flecha del teclado. Con la
    // escritura colgada del `onChange`, recorrer la lista buscando una tienda
    // habría insertado todas las de en medio.
    pintar(dia());

    fireEvent.change(selectorDeTienda(), { target: { value: "t2" } });

    await waitFor(() => expect(acciones.agregarParada).not.toHaveBeenCalled());
  });

  it("añadir confirma la tienda elegida para ese día", async () => {
    acciones.agregarParada.mockResolvedValue({ ok: true });
    pintar(dia());

    fireEvent.change(selectorDeTienda(), { target: { value: "t2" } });
    fireEvent.click(screen.getByRole("button", { name: "Añadir" }));

    await waitFor(() =>
      expect(acciones.agregarParada).toHaveBeenCalledWith({
        mercaderistaId: "m1",
        fecha: "2026-08-03",
        tiendaId: "t2",
      }),
    );
  });

  it("sin tienda elegida no se puede confirmar", () => {
    pintar(dia());
    expect(screen.getByRole("button", { name: "Añadir" })).toBeDisabled();
  });

  it("quitar una parada la quita y anuncia el resultado", async () => {
    acciones.quitarParada.mockResolvedValue({ ok: true });
    pintar(dia());

    fireEvent.click(
      screen.getByRole("button", { name: "Quitar Tottus Angamos" }),
    );

    await waitFor(() =>
      expect(acciones.quitarParada).toHaveBeenCalledWith({ paradaId: "b" }),
    );
    expect(
      await screen.findByText(/Tottus Angamos quitada/),
    ).toBeInTheDocument();
  });

  it("quitar mueve el foco antes de que la fila desaparezca", () => {
    // Sin esto el foco cae a `<body>` y se pierde el sitio en la lista.
    acciones.quitarParada.mockResolvedValue({ ok: true });
    pintar(dia());

    fireEvent.click(
      screen.getByRole("button", { name: "Quitar Tottus Angamos" }),
    );

    expect(selectorDeTienda()).toHaveFocus();
  });

  it("un borrador con paradas se puede publicar", () => {
    pintar(dia());
    expect(
      screen.getByRole("button", { name: "Publicar" }),
    ).toBeInTheDocument();
  });

  it("un día vacío no ofrece publicar: no significaría nada", () => {
    pintar(dia({ paradas: [] }));
    expect(
      screen.queryByRole("button", { name: "Publicar" }),
    ).not.toBeInTheDocument();
  });

  it("un rutero EN CURSO no se replanifica ni se republica", () => {
    // El mercaderista está en la calle con él.
    pintar(dia({ estado: "en_curso" }));
    expect(
      screen.queryByRole("combobox", { name: /Añadir tienda/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Subir/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Publicar" }),
    ).not.toBeInTheDocument();
  });

  it("mientras la acción está en vuelo lo dice y no admite otra", async () => {
    let resolver: (r: { ok: boolean }) => void = () => {};
    acciones.publicarRutero.mockReturnValue(
      new Promise((r) => {
        resolver = r;
      }),
    );
    pintar(dia());

    fireEvent.click(screen.getByRole("button", { name: "Publicar" }));

    const enVuelo = await screen.findByRole("button", { name: "Publicando…" });
    expect(enVuelo).toBeDisabled();
    resolver({ ok: true });
  });

  it("si el servidor rechaza, lo dice en vez de tragárselo", async () => {
    acciones.publicarRutero.mockResolvedValue({
      ok: false,
      error: "No encontrado o sin permiso",
    });
    pintar(dia());

    fireEvent.click(screen.getByRole("button", { name: "Publicar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No encontrado o sin permiso",
    );
  });

  it("en la vista mensual el día nace plegado y se despliega", () => {
    // Son 31 tarjetas: abrirlas todas convierte la pantalla en un muro.
    pintar(dia(), true);
    const cabecera = screen.getByRole("button", { expanded: false });
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();

    fireEvent.click(cabecera);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
  });

  it("plegado sigue diciendo cuántas paradas tiene el día", () => {
    pintar(dia(), true);
    expect(screen.getByRole("button", { expanded: false })).toHaveTextContent(
      "(2)",
    );
  });
});

describe("hora esperada de una parada", () => {
  it("se guarda al SALIR del campo, no en cada tecla", async () => {
    // Un `input[type=time]` emite `change` en cada pulsación: colgar el guardado
    // del `onChange` mandaría una escritura por tecla y guardaría horas a medio
    // teclear por el camino.
    acciones.fijarHoraParada.mockResolvedValue({ ok: true });
    render(<DiaRutero dia={dia()} mercaderistaId="m1" tiendas={TIENDAS} />);

    const campo = screen.getByLabelText(
      /Hora esperada, parada 1, Plaza Vea Surco/,
    );
    fireEvent.change(campo, { target: { value: "08:30" } });
    expect(acciones.fijarHoraParada).not.toHaveBeenCalled();

    fireEvent.blur(campo);
    await waitFor(() =>
      expect(acciones.fijarHoraParada).toHaveBeenCalledWith({
        paradaId: "a",
        hora: "08:30",
      }),
    );
  });

  it("salir sin haberla cambiado no escribe nada", () => {
    acciones.fijarHoraParada.mockResolvedValue({ ok: true });
    render(
      <DiaRutero
        dia={dia({
          paradas: [
            {
              id: "a",
              orden: 1,
              tiendaId: "t1",
              tiendaNombre: "Plaza Vea Surco",
              hora: "08:30",
            },
          ],
        })}
        mercaderistaId="m1"
        tiendas={TIENDAS}
      />,
    );

    fireEvent.blur(
      screen.getByLabelText(/Hora esperada, parada 1, Plaza Vea Surco/),
    );
    expect(acciones.fijarHoraParada).not.toHaveBeenCalled();
  });

  it("vaciar el campo la quita, y se anuncia", async () => {
    acciones.fijarHoraParada.mockResolvedValue({ ok: true });
    render(
      <DiaRutero
        dia={dia({
          paradas: [
            {
              id: "a",
              orden: 1,
              tiendaId: "t1",
              tiendaNombre: "Plaza Vea Surco",
              hora: "08:30",
            },
          ],
        })}
        mercaderistaId="m1"
        tiendas={TIENDAS}
      />,
    );

    const campo = screen.getByLabelText(
      /Hora esperada, parada 1, Plaza Vea Surco/,
    );
    fireEvent.change(campo, { target: { value: "" } });
    fireEvent.blur(campo);

    await waitFor(() =>
      expect(acciones.fijarHoraParada).toHaveBeenCalledWith({
        paradaId: "a",
        hora: "",
      }),
    );
    expect(
      await screen.findByText(/se queda sin hora esperada/),
    ).toBeInTheDocument();
  });

  it("un rutero ya publicado la MUESTRA pero no la deja editar", () => {
    // La hora es la vara con la que se mide la puntualidad: moverla después de
    // publicar sería cambiar el listón con el mercaderista ya en la calle.
    render(
      <DiaRutero
        dia={dia({
          estado: "publicado",
          paradas: [
            {
              id: "a",
              orden: 1,
              tiendaId: "t1",
              tiendaNombre: "Plaza Vea Surco",
              hora: "08:30",
            },
          ],
        })}
        mercaderistaId="m1"
        tiendas={TIENDAS}
      />,
    );

    expect(screen.getByText("08:30")).toBeInTheDocument();
    // Y dice QUÉ es esa hora para quien no ve dónde está colocada.
    expect(screen.getByText("Hora esperada:")).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Hora esperada, parada 1, Plaza Vea Surco/),
    ).not.toBeInTheDocument();
  });
});

describe("la hora cuando la base falla", () => {
  it("un error se cuenta, no se pierde", async () => {
    acciones.fijarHoraParada.mockResolvedValue({
      ok: false,
      error: "No se pudo guardar el cambio",
    });
    render(<DiaRutero dia={dia()} mercaderistaId="m1" tiendas={TIENDAS} />);

    const campo = screen.getByLabelText(/Hora esperada, parada 1/);
    fireEvent.change(campo, { target: { value: "08:30" } });
    fireEvent.blur(campo);

    expect(
      await screen.findByText("No se pudo guardar el cambio"),
    ).toBeInTheDocument();
  });
});
