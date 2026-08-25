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
        tieneVisita: false,
      },
      {
        id: "b",
        orden: 2,
        tiendaId: "t2",
        tiendaNombre: "Tottus Angamos",
        hora: null,
        tieneVisita: false,
      },
    ],
    ...over,
  };
}

/** El "hoy" por defecto es la fecha del fixture: así el día bajo prueba es HOY y
 *  el guardarraíl de días pasados no se cuela en tests que hablan de otra cosa. */
const HOY = "2026-08-03";

function pintar(d: DiaPlaneado, compacto = false, hoyLima = HOY) {
  return render(
    <DiaRutero
      dia={d}
      mercaderistaId="m1"
      tiendas={TIENDAS}
      hoyLima={hoyLima}
      compacto={compacto}
    />,
  );
}

/**
 * Abre el modo de edición de una parada. Los controles (hora, orden, eliminar)
 * ya no cuelgan de la fila: viven tras UN botón "Editar", el mismo en los
 * cuatro estados del rutero.
 */
function abrirEditor(tienda: string | RegExp) {
  fireEvent.click(
    screen.getByRole("button", {
      name: typeof tienda === "string" ? `Editar ${tienda}` : tienda,
    }),
  );
}

/** La primera parada de la lista, que es de la que hablan los tests de hora. */
function abrirPrimerEditor() {
  fireEvent.click(screen.getAllByRole("button", { name: /^Editar / })[0]!);
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

    abrirEditor("Tottus Angamos");
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
    abrirEditor("Plaza Vea Surco");
    const subirPrimera = screen.getByRole("button", {
      name: /Subir Plaza Vea/,
    });
    expect(subirPrimera).toHaveAttribute("aria-disabled", "true");
    expect(subirPrimera).not.toBeDisabled();

    // La última fila, en su propio editor: solo hay una parada en edición a la
    // vez, porque el reorden manda la lista COMPLETA y dos editores abiertos
    // con órdenes distintos en vuelo se pisarían.
    abrirEditor("Tottus Angamos");
    expect(
      screen.getByRole("button", { name: /Bajar Tottus/ }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("un botón inactivo no reordena aunque se pulse", () => {
    pintar(dia());
    abrirEditor("Plaza Vea Surco");
    fireEvent.click(screen.getByRole("button", { name: /Subir Plaza Vea/ }));
    expect(acciones.reordenarParadas).not.toHaveBeenCalled();
  });

  it("cada botón dice QUÉ parada mueve, no solo la flecha", () => {
    // El símbolo es decorativo: con un lector de pantalla, seis botones "↑" en
    // una lista no dicen nada.
    pintar(dia());
    abrirEditor("Plaza Vea Surco");
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

    abrirEditor("Tottus Angamos");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Eliminar Tottus Angamos de la ruta",
      }),
    );

    await waitFor(() =>
      expect(acciones.quitarParada).toHaveBeenCalledWith({ paradaId: "b" }),
    );
    expect(
      await screen.findByText(/Tottus Angamos quitada/),
    ).toBeInTheDocument();
  });

  it("quitar mueve el foco al vecino antes de que la fila desaparezca", () => {
    // Sin esto el foco cae a `<body>` y se pierde el sitio en la lista. El
    // destino ya no es el selector de tiendas: en un rutero publicado no se
    // renderiza, y ese es justo el caso que este ticket viene a abrir.
    acciones.quitarParada.mockResolvedValue({ ok: true });
    pintar(dia());

    abrirEditor("Tottus Angamos");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Eliminar Tottus Angamos de la ruta",
      }),
    );

    expect(
      screen.getByRole("button", { name: "Editar Plaza Vea Surco" }),
    ).toHaveFocus();
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
  it("se guarda al pulsar Guardar, no en cada tecla", async () => {
    // Un `input[type=time]` emite `change` en cada pulsación: colgar el guardado
    // del `onChange` mandaría una escritura por tecla y guardaría horas a medio
    // teclear por el camino. Y tampoco cuelga del `blur`, que es lo que hacía
    // que "Cancelar" escribiera igual: el clic saca el foco del campo antes de
    // que corra su `onClick`.
    acciones.fijarHoraParada.mockResolvedValue({ ok: true });
    render(
      <DiaRutero
        dia={dia()}
        mercaderistaId="m1"
        tiendas={TIENDAS}
        hoyLima={HOY}
      />,
    );

    abrirPrimerEditor();
    const campo = screen.getByLabelText(
      /Hora esperada, parada 1, Plaza Vea Surco/,
    );
    fireEvent.change(campo, { target: { value: "08:30" } });
    expect(acciones.fijarHoraParada).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
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
              tieneVisita: false,
            },
          ],
        })}
        mercaderistaId="m1"
        tiendas={TIENDAS}
        hoyLima={HOY}
      />,
    );

    abrirPrimerEditor();
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
              tieneVisita: false,
            },
          ],
        })}
        mercaderistaId="m1"
        tiendas={TIENDAS}
        hoyLima={HOY}
      />,
    );

    abrirPrimerEditor();
    const campo = screen.getByLabelText(
      /Hora esperada, parada 1, Plaza Vea Surco/,
    );
    fireEvent.change(campo, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

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
              tieneVisita: false,
            },
          ],
        })}
        mercaderistaId="m1"
        tiendas={TIENDAS}
        hoyLima={HOY}
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
    render(
      <DiaRutero
        dia={dia()}
        mercaderistaId="m1"
        tiendas={TIENDAS}
        hoyLima={HOY}
      />,
    );

    abrirPrimerEditor();
    const campo = screen.getByLabelText(/Hora esperada, parada 1/);
    fireEvent.change(campo, { target: { value: "08:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      await screen.findByText("No se pudo guardar el cambio"),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// El modo de edición por parada
//
// Lo que hace valiosa esta forma no es la estética: da un sitio donde EXPLICAR
// por qué algo no se puede. Antes los controles desaparecían del DOM en cuanto
// el rutero salía del borrador, y el supervisor no podía distinguir «no se
// puede» de «no está».
// ---------------------------------------------------------------------------

const ESTADOS = ["borrador", "publicado", "en_curso", "completado"] as const;

function botonEliminar(tienda = "Plaza Vea Surco") {
  return screen.getByRole("button", { name: `Eliminar ${tienda} de la ruta` });
}

describe("modo de edición por parada", () => {
  it.each(ESTADOS)(
    "cada parada ofrece UN botón Editar, también en %s",
    (estado) => {
      pintar(dia({ estado }));
      const editar = screen.getAllByRole("button", { name: /^Editar / });
      expect(editar).toHaveLength(2);
      // Y ningún control suelto fuera del editor: una sola gramática.
      expect(
        screen.queryByRole("button", { name: /^Subir / }),
      ).not.toBeInTheDocument();
    },
  );

  it("dentro del editor están hora, orden, eliminar, cancelar y guardar", () => {
    pintar(dia());
    abrirEditor("Plaza Vea Surco");

    expect(
      screen.getByLabelText(/Hora esperada, parada 1/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Subir Plaza Vea/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Bajar Plaza Vea/ }),
    ).toBeInTheDocument();
    expect(botonEliminar()).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancelar" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeInTheDocument();
  });

  it("solo una parada en edición a la vez", () => {
    // El reorden manda la lista COMPLETA: dos editores abiertos con órdenes
    // distintos en vuelo se pisarían.
    pintar(dia());
    abrirEditor("Plaza Vea Surco");
    abrirEditor("Tottus Angamos");

    expect(screen.getAllByRole("button", { name: "Cancelar" })).toHaveLength(1);
    expect(botonEliminar("Tottus Angamos")).toBeInTheDocument();
  });

  it("cancelar cierra el editor y devuelve el foco a su botón", async () => {
    pintar(dia());
    abrirEditor("Plaza Vea Surco");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Editar Plaza Vea Surco" }),
      ).toHaveFocus(),
    );
  });

  it("al abrir el editor el foco entra en él", () => {
    // Sin esto, quien navega con teclado pulsa "Editar" y se queda donde estaba,
    // con controles nuevos que no sabe que aparecieron.
    pintar(dia());
    abrirEditor("Plaza Vea Surco");
    expect(screen.getByLabelText(/Hora esperada, parada 1/)).toHaveFocus();
  });

  it("en un rutero PUBLICADO se puede eliminar", () => {
    acciones.quitarParada.mockResolvedValue({ ok: true });
    pintar(dia({ estado: "publicado" }));
    abrirEditor("Plaza Vea Surco");

    const boton = botonEliminar();
    expect(boton).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(boton);
    expect(acciones.quitarParada).toHaveBeenCalledWith({ paradaId: "a" });
  });

  it.each([
    ["en_curso", "El día ya empezó"],
    ["completado", "El día ya cerró"],
  ] as const)(
    "en %s Eliminar sigue AHÍ, inhabilitado y con su motivo",
    (estado, motivo) => {
      // El criterio entero del ticket: nunca ausente. Un botón que no existe no
      // se distingue de uno que falla.
      pintar(dia({ estado }));
      abrirEditor("Plaza Vea Surco");

      const boton = botonEliminar();
      expect(boton).toBeInTheDocument();
      expect(boton).toHaveAttribute("aria-disabled", "true");
      // `aria-disabled`, no `disabled`: si no fuera enfocable, su motivo no lo
      // oiría nadie.
      expect(boton).not.toBeDisabled();
      expect(screen.getByText(motivo)).toBeInTheDocument();
      expect(boton.getAttribute("aria-describedby")).toBe(
        screen.getByText(motivo).id,
      );

      fireEvent.click(boton);
      expect(acciones.quitarParada).not.toHaveBeenCalled();
    },
  );

  it.each(ESTADOS)(
    "una parada con VISITA no se elimina en %s, y dice por qué",
    (estado) => {
      pintar(
        dia({
          estado,
          paradas: [
            {
              id: "a",
              orden: 1,
              tiendaId: "t1",
              tiendaNombre: "Plaza Vea Surco",
              hora: null,
              tieneVisita: true,
            },
          ],
        }),
      );
      abrirEditor("Plaza Vea Surco");

      expect(botonEliminar()).toHaveAttribute("aria-disabled", "true");
      // La visita gana la precedencia: es la razón más concreta, y la que el
      // servidor aplicaría igualmente.
      expect(
        screen.getByText("Ya tiene una visita registrada"),
      ).toBeInTheDocument();
      fireEvent.click(botonEliminar());
      expect(acciones.quitarParada).not.toHaveBeenCalled();
    },
  );

  it("un día YA PASADO no se puede tocar, y lo dice", () => {
    // `rutero.estado` no sale nunca de `publicado`, así que sin esto el rutero de
    // hace tres meses seguiría siendo editable — y quitarle una parada borraría
    // un `falto` del periodo abierto.
    pintar(
      dia({ estado: "publicado", fecha: "2026-08-01" }),
      false,
      "2026-08-03",
    );
    abrirEditor("Plaza Vea Surco");

    expect(botonEliminar()).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Ese día ya pasó")).toBeInTheDocument();
  });

  it("el rechazo del SERVIDOR se pinta, aunque el botón estuviera habilitado", async () => {
    // El estado puede cambiar entre que la pantalla se pinta y el supervisor
    // pulsa: esconder el botón no basta, y el mensaje del servidor manda.
    acciones.quitarParada.mockResolvedValue({
      ok: false,
      error:
        "Esa tienda ya tiene una visita registrada: no se puede quitar de la ruta.",
    });
    pintar(dia({ estado: "publicado" }));
    abrirEditor("Plaza Vea Surco");
    fireEvent.click(botonEliminar());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /ya tiene una visita registrada/,
    );
  });

  it("la hora NO se edita fuera del borrador, y se explica en vez de esconderse", () => {
    // La base lo rechaza a propósito: la hora es la vara que mide la puntualidad
    // y de ahí sale el bono. Moverla tras publicar —cuando ya puede haber
    // fichado— sería fabricar el resultado, no planificar.
    pintar(
      dia({
        estado: "publicado",
        paradas: [
          {
            id: "a",
            orden: 1,
            tiendaId: "t1",
            tiendaNombre: "Plaza Vea Surco",
            hora: "08:30",
            tieneVisita: false,
          },
        ],
      }),
    );
    abrirEditor("Plaza Vea Surco");

    expect(
      screen.queryByLabelText(/Hora esperada, parada 1/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/La hora fija la puntualidad y el día ya se publicó/),
    ).toBeInTheDocument();
    // Y el valor sigue a la vista: se explica, no se esconde.
    expect(screen.getByText("08:30")).toBeInTheDocument();
  });

  it("quitar la ÚLTIMA parada manda el foco al título del día", () => {
    acciones.quitarParada.mockResolvedValue({ ok: true });
    pintar(
      dia({
        paradas: [
          {
            id: "a",
            orden: 1,
            tiendaId: "t1",
            tiendaNombre: "Plaza Vea Surco",
            hora: null,
            tieneVisita: false,
          },
        ],
      }),
    );
    abrirEditor("Plaza Vea Surco");
    fireEvent.click(botonEliminar());

    expect(screen.getByRole("heading", { name: /lun 3/ })).toHaveFocus();
  });

  it("la región viva es EL MISMO nodo antes y después de actuar", async () => {
    // Montarla junto con el mensaje lo anunciaría en el mismo instante en que se
    // inserta, y algunos lectores se lo pierden.
    acciones.quitarParada.mockResolvedValue({ ok: true });
    const { container } = pintar(dia());
    const antes = container.querySelector('[aria-live="polite"]');

    abrirEditor("Tottus Angamos");
    fireEvent.click(botonEliminar("Tottus Angamos"));
    await screen.findByText(/Tottus Angamos quitada/);

    expect(container.querySelector('[aria-live="polite"]')).toBe(antes);
  });

  it("entrar en el editor se anuncia", async () => {
    pintar(dia());
    abrirEditor("Plaza Vea Surco");
    expect(
      await screen.findByText("Editando Plaza Vea Surco"),
    ).toBeInTheDocument();
  });
});

describe("Guardar guarda y Cancelar cancela", () => {
  // El orden real del navegador al pulsar un botón teniendo el foco en el campo
  // es `mousedown` → `blur` del campo → `click`. `fireEvent.click` NO mueve el
  // foco en jsdom, así que un test que solo haga clic pasa en verde aunque en un
  // navegador el `blur` hubiera escrito ya. Por eso el `blur` va explícito.
  it("cancelar NO escribe la hora que se estaba tecleando", async () => {
    acciones.fijarHoraParada.mockResolvedValue({ ok: true });
    pintar(dia());
    abrirPrimerEditor();

    const campo = screen.getByLabelText(/Hora esperada, parada 1/);
    fireEvent.change(campo, { target: { value: "09:45" } });
    fireEvent.blur(campo);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(acciones.fijarHoraParada).not.toHaveBeenCalled(),
    );
  });

  it("guardar SÍ escribe la hora tecleada", async () => {
    acciones.fijarHoraParada.mockResolvedValue({ ok: true });
    pintar(dia());
    abrirPrimerEditor();

    const campo = screen.getByLabelText(/Hora esperada, parada 1/);
    fireEvent.change(campo, { target: { value: "09:45" } });
    fireEvent.blur(campo);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(acciones.fijarHoraParada).toHaveBeenCalledWith({
        paradaId: "a",
        hora: "09:45",
      }),
    );
  });

  it("guardar sin haber tocado la hora no escribe nada", async () => {
    pintar(dia());
    abrirPrimerEditor();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(acciones.fijarHoraParada).not.toHaveBeenCalled(),
    );
  });

  it("cuando la hora NO es editable, el foco entra igual en el editor", () => {
    // El caso central del ticket: en un rutero publicado el campo de hora no se
    // renderiza, y sin un respaldo el foco caía a `<body>`.
    pintar(dia({ estado: "publicado" }));
    abrirEditor("Plaza Vea Surco");
    expect(document.activeElement).not.toBe(document.body);
  });

  it("en vista MENSUAL, quitar la última parada manda el foco al título", () => {
    // El título compacto es un `<button>`, no el `<h3>`: con la ref atada solo al
    // `<h3>` el foco caía a `<body>` justo en la vista de 31 tarjetas.
    acciones.quitarParada.mockResolvedValue({ ok: true });
    pintar(
      dia({
        paradas: [
          {
            id: "a",
            orden: 1,
            tiendaId: "t1",
            tiendaNombre: "Plaza Vea Surco",
            hora: null,
            tieneVisita: false,
          },
        ],
      }),
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: /lun 3/ }));
    abrirEditor("Plaza Vea Surco");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Eliminar Plaza Vea Surco de la ruta",
      }),
    );

    expect(screen.getByRole("button", { name: /lun 3/ })).toHaveFocus();
  });
});
