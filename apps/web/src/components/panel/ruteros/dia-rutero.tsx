"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { Pastilla } from "@/components/panel/tabla";
import {
  agregarParada,
  fijarHoraParada,
  publicarRutero,
  quitarParada,
  reordenarParadas,
} from "@/lib/panel/acciones-ruteros";
import {
  moverParada,
  type Parada,
  type Permiso,
  sePuedeEditarHora,
  sePuedePublicar,
  sePuedeQuitarParada,
  sePuedeReordenar,
  type DiaPlaneado,
} from "@/lib/panel/ruteros";

// Un día del calendario de planeación: sus paradas en orden, con qué hacerles.
//
// Cada parada se toca desde UN botón "Editar", el mismo en los cuatro estados
// del rutero. Antes los controles (↑ ↓ ×) desaparecían del DOM en cuanto el
// rutero salía del borrador, y el supervisor no podía distinguir «no se puede»
// de «no está» — la única salida para quitar una tienda mal puesta era borrar el
// rutero entero. El modo de edición existe sobre todo por eso: es un sitio donde
// EXPLICAR por qué algo no se puede, en vez de esconderlo.
//
// Reordenar es con botones ↑/↓ y no arrastrando: una lista arrastrable no se
// puede recorrer con teclado sin escribir un segundo mecanismo entero, y una
// ruta real son cinco u ocho paradas. El arrastre se puede añadir encima de esto
// sin rehacer nada.

// `borrador` va en tono neutro y el ámbar queda solo para `en_curso`: en un
// calendario de 31 tarjetas el supervisor escanea por color, y "aún sin publicar"
// no puede pintarse igual que "el mercaderista está ahora mismo en la tienda".
//
// `publicado` y `completado` sí comparten el verde, y es deliberado: en esta
// pantalla los dos significan "la planeación de ese día ya está hecha", que es lo
// que se escanea. Cuál de los dos es lo dice la pastilla, y de paso la fecha.
const ESTILO_ESTADO = {
  borrador: "bg-muted text-muted-foreground",
  publicado: "bg-completado-suave text-completado-texto",
  en_curso: "bg-en-curso-suave text-en-curso-texto",
  completado: "bg-completado-suave text-completado-texto",
} as const;

const ETIQUETA_ESTADO = {
  borrador: "Borrador",
  publicado: "Publicado",
  en_curso: "En curso",
  completado: "Completado",
} as const;

const NOMBRE_DIA = new Intl.DateTimeFormat("es-PE", {
  weekday: "short",
  day: "numeric",
  timeZone: "UTC",
});

export type Tienda = { id: string; nombre: string };

export function DiaRutero({
  dia,
  mercaderistaId,
  tiendas,
  hoyLima,
  compacto = false,
}: {
  dia: DiaPlaneado;
  mercaderistaId: string;
  tiendas: Tienda[];
  /**
   * El día de hoy en Lima, resuelto en el SERVIDOR. Se pasa como prop en vez de
   * calcularlo aquí porque un `new Date()` en el cliente daría un valor distinto
   * al del render del servidor justo alrededor de medianoche, y React avisaría
   * de un desajuste de hidratación por algo que además es del negocio, no del
   * reloj del navegador.
   */
  hoyLima: string;
  /** La vista mensual muestra 31 días: ahí el detalle se abre bajo demanda. */
  compacto?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState("");
  const [aAgregar, setAAgregar] = useState("");
  const [pendiente, iniciar] = useTransition();
  const [abierto, setAbierto] = useState(!compacto);
  const [enEdicion, setEnEdicion] = useState<string | null>(null);
  const selectorTienda = useRef<HTMLSelectElement>(null);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  // Los botones "Editar" de cada fila, para devolverles el foco al cerrar el
  // editor y para dárselo al vecino cuando una fila desaparece del DOM.
  const botonesEditar = useRef(new Map<string, HTMLButtonElement | null>());

  // Añadir una tienda sigue siendo cosa del borrador: el caso simétrico —colgar
  // una tienda de un rutero ya publicado— no se pidió, y la base lo rechaza.
  const sePuedeAgregar = dia.estado === null || dia.estado === "borrador";

  /**
   * Lanza una acción y cuenta cómo fue. El `anuncio` es la única señal de éxito
   * que recibe un lector de pantalla: sin él la lista cambia en silencio y quien
   * no ve la pantalla no sabe si el clic hizo algo.
   */
  function ejecutar(
    accion: () => Promise<{ ok: boolean; error?: string }>,
    exito: string,
  ) {
    setError(null);
    setAnuncio("");
    iniciar(async () => {
      const r = await accion();
      if (r.ok) setAnuncio(exito);
      else setError(r.error ?? "No se pudo guardar el cambio");
    });
  }

  /** Cierra el editor y devuelve el foco al "Editar" de esa misma fila. */
  function cerrarEditor(paradaId: string, anuncioAlCerrar?: string) {
    setEnEdicion(null);
    if (anuncioAlCerrar) setAnuncio(anuncioAlCerrar);
    // En el siguiente frame la fila ya volvió a su forma plegada y el botón
    // existe otra vez.
    requestAnimationFrame(() => botonesEditar.current.get(paradaId)?.focus());
  }

  /**
   * A dónde va el foco cuando la fila `indice` desaparece del DOM: al vecino de
   * arriba, si no al de abajo, y si era la única al título del día. Se llama
   * ANTES de disparar la acción — después, el elemento ya no está y el navegador
   * habría mandado el foco a `<body>`.
   */
  function moverFocoTrasQuitar(indice: number) {
    const vecino = dia.paradas[indice - 1] ?? dia.paradas[indice + 1];
    const boton = vecino ? botonesEditar.current.get(vecino.id) : null;
    if (boton) {
      boton.focus();
      return;
    }
    tituloRef.current?.focus();
  }

  const titulo = NOMBRE_DIA.format(new Date(`${dia.fecha}T12:00:00Z`));
  const permisoReordenar = sePuedeReordenar(dia);
  const permisoHora = sePuedeEditarHora(dia);

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        {compacto ? (
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            aria-expanded={abierto}
            className="text-[12.5px] font-bold capitalize hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {titulo}{" "}
            <span className="font-normal text-muted-foreground">
              ({dia.paradas.length})
            </span>
          </button>
        ) : (
          // `tabIndex={-1}`: no entra en el recorrido de tabulación, pero puede
          // recibir el foco por código cuando se quita la última parada y no
          // queda ningún vecino al que saltar.
          <h3
            ref={tituloRef}
            tabIndex={-1}
            className="text-[12.5px] font-bold capitalize focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {titulo}
          </h3>
        )}
        {dia.estado ? (
          <Pastilla tono={ESTILO_ESTADO[dia.estado]}>
            {ETIQUETA_ESTADO[dia.estado]}
          </Pastilla>
        ) : null}
      </div>

      {abierto ? (
        <>
          {dia.paradas.length === 0 ? (
            <p className="text-[11.5px] text-muted-foreground">Sin paradas.</p>
          ) : (
            <ol className="flex flex-col gap-1">
              {dia.paradas.map((p, i) => (
                <ParadaFila
                  key={p.id}
                  parada={p}
                  posicion={i + 1}
                  esPrimera={i === 0}
                  esUltima={i === dia.paradas.length - 1}
                  editando={enEdicion === p.id}
                  pendiente={pendiente}
                  permisoQuitar={sePuedeQuitarParada(dia, p, hoyLima)}
                  permisoReordenar={permisoReordenar}
                  permisoHora={permisoHora}
                  refBotonEditar={(el) => botonesEditar.current.set(p.id, el)}
                  onEditar={() => {
                    setEnEdicion(p.id);
                    setAnuncio(`Editando ${p.tiendaNombre}`);
                  }}
                  onCerrar={() => cerrarEditor(p.id)}
                  onCancelar={() =>
                    cerrarEditor(p.id, `Edición de ${p.tiendaNombre} cancelada`)
                  }
                  onHora={(hora) =>
                    ejecutar(
                      () => fijarHoraParada({ paradaId: p.id, hora }),
                      hora === ""
                        ? `${p.tiendaNombre} se queda sin hora esperada`
                        : `${p.tiendaNombre} se espera a las ${hora}`,
                    )
                  }
                  onMover={(direccion) =>
                    ejecutar(
                      () =>
                        reordenarParadas({
                          ruteroId: dia.ruteroId,
                          paradas: moverParada(dia.paradas, p.id, direccion),
                        }),
                      direccion === -1
                        ? `${p.tiendaNombre} sube a la posición ${i}`
                        : `${p.tiendaNombre} baja a la posición ${i + 2}`,
                    )
                  }
                  onQuitar={() => {
                    // El foco se coloca ANTES: la fila entera —y con ella este
                    // botón— desaparece del DOM, y el navegador lo mandaría a
                    // `<body>`.
                    moverFocoTrasQuitar(i);
                    setEnEdicion(null);
                    ejecutar(
                      () => quitarParada({ paradaId: p.id }),
                      `${p.tiendaNombre} quitada de la ruta`,
                    );
                  }}
                />
              ))}
            </ol>
          )}

          {sePuedeAgregar ? (
            // Elegir y confirmar van separados a propósito. Un `<select>` cerrado
            // emite `change` en CADA flecha del teclado, no solo al confirmar: con
            // la escritura colgada del `onChange`, recorrer la lista de tiendas
            // buscando una habría insertado todas las de en medio.
            <div className="flex gap-1">
              <label className="min-w-0 flex-1">
                <span className="sr-only">Añadir tienda al {titulo}</span>
                <select
                  ref={selectorTienda}
                  value={aAgregar}
                  onChange={(e) => setAAgregar(e.target.value)}
                  className="min-h-11 w-full rounded-lg border border-border bg-background px-2 text-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <option value="">Añadir tienda…</option>
                  {tiendas.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={pendiente || aAgregar === ""}
                onClick={() => {
                  const tiendaId = aAgregar;
                  const nombre =
                    tiendas.find((t) => t.id === tiendaId)?.nombre ?? "Tienda";
                  setAAgregar("");
                  ejecutar(
                    () =>
                      agregarParada({
                        mercaderistaId,
                        fecha: dia.fecha,
                        tiendaId,
                      }),
                    `${nombre} añadida a la ruta`,
                  );
                }}
                className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-[12px] font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40"
              >
                Añadir
              </button>
            </div>
          ) : null}

          {sePuedePublicar(dia) ? (
            <button
              type="button"
              disabled={pendiente}
              onClick={() =>
                ejecutar(
                  () => publicarRutero({ ruteroId: dia.ruteroId }),
                  `Rutero del ${titulo} publicado`,
                )
              }
              className="min-h-11 rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
            >
              {pendiente ? "Publicando…" : "Publicar"}
            </button>
          ) : null}

          {error ? (
            <p role="alert" className="text-[11.5px] text-alerta-texto">
              {error}
            </p>
          ) : null}

          {/* El éxito es invisible para quien no ve la lista cambiar. La región
              se monta desde el primer render y solo cambia su TEXTO: montarla
              junto con el mensaje lo anunciaría en el mismo instante en que se
              inserta, y algunos lectores se lo pierden. */}
          <p aria-live="polite" className="sr-only">
            {anuncio}
          </p>
        </>
      ) : null}
    </section>
  );
}

/**
 * Una parada: plegada enseña su nombre, su hora y un botón "Editar"; desplegada,
 * los controles.
 *
 * El botón es el MISMO en los cuatro estados del rutero. Lo que cambia es qué
 * hay dentro y qué se puede hacer — y cuando no se puede, por qué.
 */
function ParadaFila({
  parada,
  posicion,
  esPrimera,
  esUltima,
  editando,
  pendiente,
  permisoQuitar,
  permisoReordenar,
  permisoHora,
  refBotonEditar,
  onEditar,
  onCerrar,
  onCancelar,
  onHora,
  onMover,
  onQuitar,
}: {
  parada: Parada;
  posicion: number;
  esPrimera: boolean;
  esUltima: boolean;
  editando: boolean;
  pendiente: boolean;
  permisoQuitar: Permiso;
  permisoReordenar: Permiso;
  permisoHora: Permiso;
  refBotonEditar: (el: HTMLButtonElement | null) => void;
  onEditar: () => void;
  onCerrar: () => void;
  onCancelar: () => void;
  onHora: (hora: string) => void;
  onMover: (direccion: -1 | 1) => void;
  onQuitar: () => void;
}) {
  const primerControl = useRef<HTMLInputElement>(null);
  const motivoQuitarId = `motivo-quitar-${parada.id}`;
  const motivoHoraId = `motivo-hora-${parada.id}`;

  // Al abrir el editor el foco entra en él. Sin esto, quien navega con teclado
  // pulsa "Editar" y se queda donde estaba, con controles nuevos que no sabe que
  // aparecieron.
  useEffect(() => {
    if (editando) primerControl.current?.focus();
  }, [editando]);

  return (
    <li className="rounded-lg bg-muted px-2 py-1">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className="w-4 shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {posicion}
        </span>
        <span className="min-w-0 flex-1 basis-[8rem] truncate text-[12px]">
          {parada.tiendaNombre}
        </span>

        {!editando && parada.hora ? (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {/* Sin esto, un lector de pantalla lee "08:30" a secas después del
                nombre de la tienda y no dice de qué hora habla: en pantalla lo
                dice la posición, que no se oye. */}
            <span className="sr-only">Hora esperada: </span>
            {parada.hora}
          </span>
        ) : null}

        {!editando ? (
          <button
            ref={refBotonEditar}
            type="button"
            onClick={onEditar}
            aria-label={`Editar ${parada.tiendaNombre}`}
            className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-[12px] font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Editar
          </button>
        ) : null}
      </div>

      {editando ? (
        <div className="flex flex-col gap-2 pb-1 pt-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {permisoHora.puede ? (
              <HoraParada
                ref={primerControl}
                parada={parada}
                posicion={posicion}
                inactivo={pendiente}
                onGuardar={onHora}
              />
            ) : (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                <span className="tabular-nums">
                  {parada.hora ?? "Sin hora esperada"}
                </span>{" "}
                <span id={motivoHoraId}>· {permisoHora.motivo}</span>
              </span>
            )}

            <BotonOrden
              etiqueta={`Subir ${parada.tiendaNombre}`}
              simbolo="↑"
              inactivo={pendiente || esPrimera || !permisoReordenar.puede}
              onClick={() => onMover(-1)}
            />
            <BotonOrden
              etiqueta={`Bajar ${parada.tiendaNombre}`}
              simbolo="↓"
              inactivo={pendiente || esUltima || !permisoReordenar.puede}
              onClick={() => onMover(1)}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <span className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  if (!permisoQuitar.puede || pendiente) return;
                  onQuitar();
                }}
                // `aria-disabled` y no `disabled`: el botón sigue enfocable y se
                // anuncia como no disponible, que es la única forma de que su
                // motivo llegue a quien navega con lector de pantalla. Con el
                // `disabled` nativo el motivo existiría y nadie lo oiría.
                aria-disabled={!permisoQuitar.puede || pendiente}
                aria-label={`Eliminar ${parada.tiendaNombre} de la ruta`}
                aria-describedby={
                  permisoQuitar.puede ? undefined : motivoQuitarId
                }
                className="min-h-11 rounded-lg border border-alerta-texto px-3 text-[12px] font-semibold text-alerta-texto hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-disabled:cursor-default aria-disabled:border-border aria-disabled:text-muted-foreground aria-disabled:opacity-60 aria-disabled:hover:bg-transparent"
              >
                Eliminar
              </button>
              {/* El motivo se ESCRIBE, no se insinúa con un color: es todo el
                  valor de este modo de edición frente a esconder el botón. */}
              {!permisoQuitar.puede ? (
                <span
                  id={motivoQuitarId}
                  className="text-[11px] text-muted-foreground"
                >
                  {permisoQuitar.motivo}
                </span>
              ) : null}
            </span>

            <span className="flex gap-1.5">
              <button
                type="button"
                onClick={onCancelar}
                className="min-h-11 rounded-lg border border-border px-3 text-[12px] hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onCerrar}
                className="min-h-11 rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Guardar
              </button>
            </span>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * La hora esperada de una parada. Es la base de la puntualidad del mercaderista.
 *
 * Escribe al SALIR del campo, no en cada cambio: un `input[type=time]` emite
 * `change` en cada tecla y en cada flecha del reloj, así que colgar el guardado
 * del `onChange` mandaría una escritura por pulsación —y guardaría las horas a
 * medio teclear por el camino. Es la misma razón por la que el selector de tienda
 * de abajo separa elegir de confirmar.
 *
 * El valor se lleva en estado local para que el campo no se quede pegado al valor
 * viejo mientras la revalidación viaja. Y por eso "Guardar" no tiene que hacer
 * nada: el `blur` que provoca pulsarlo ya escribió.
 */
function HoraParada({
  ref,
  parada,
  posicion,
  inactivo,
  onGuardar,
}: {
  ref?: React.Ref<HTMLInputElement>;
  parada: Parada;
  /** Va en la etiqueta: nada impide dos paradas en la MISMA tienda el mismo día,
   *  y entonces dos campos se llamarían igual. */
  posicion: number;
  inactivo: boolean;
  onGuardar: (hora: string) => void;
}) {
  const [valor, setValor] = useState(parada.hora ?? "");

  return (
    <label className="shrink-0">
      <span className="sr-only">
        Hora esperada, parada {posicion}, {parada.tiendaNombre}
      </span>
      <input
        ref={ref}
        type="time"
        value={valor}
        disabled={inactivo}
        onChange={(e) => setValor(e.target.value)}
        onBlur={() => {
          if (valor === (parada.hora ?? "")) return;
          onGuardar(valor);
        }}
        className="min-h-11 rounded-lg border border-border bg-background px-1.5 text-[11px] tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
    </label>
  );
}

/**
 * Un botón de la fila de una parada.
 *
 * `aria-disabled` en vez de `disabled`, y la guarda en el `onClick`. Con el
 * `disabled` nativo, subir la segunda parada la deja primera y **deshabilita el
 * botón que se acaba de pulsar**: el navegador quita el foco de un elemento
 * recién deshabilitado y lo manda a `<body>`, así que quien navega con teclado
 * se queda sin sitio justo después de actuar. Así el botón sigue enfocable y
 * anunciándose como no disponible.
 */
function BotonOrden({
  etiqueta,
  simbolo,
  inactivo,
  onClick,
}: {
  etiqueta: string;
  simbolo: string;
  inactivo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (inactivo) return;
        onClick();
      }}
      aria-disabled={inactivo}
      // El símbolo es decorativo: lo que se lee es la etiqueta, que dice qué
      // parada se mueve y hacia dónde.
      aria-label={etiqueta}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-border text-[12px] hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-disabled:cursor-default aria-disabled:opacity-30 aria-disabled:hover:bg-transparent"
    >
      <span aria-hidden="true">{simbolo}</span>
    </button>
  );
}
