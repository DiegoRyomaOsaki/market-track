"use client";

import { useRef, useState, useTransition } from "react";

import { Pastilla } from "@/components/panel/tabla";
import {
  agregarParada,
  publicarRutero,
  quitarParada,
  reordenarParadas,
} from "@/lib/panel/acciones-ruteros";
import {
  moverParada,
  sePuedePublicar,
  type DiaPlaneado,
} from "@/lib/panel/ruteros";

// Un día del calendario de planeación: sus paradas en orden, con qué hacerles.
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
  compacto = false,
}: {
  dia: DiaPlaneado;
  mercaderistaId: string;
  tiendas: Tienda[];
  /** La vista mensual muestra 31 días: ahí el detalle se abre bajo demanda. */
  compacto?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState("");
  const [aAgregar, setAAgregar] = useState("");
  const [pendiente, iniciar] = useTransition();
  const [abierto, setAbierto] = useState(!compacto);
  const selectorTienda = useRef<HTMLSelectElement>(null);

  // Un rutero que ya empezó no se replanifica desde aquí: el mercaderista está
  // en la calle con él. El servidor lo exige también — esto es solo la UX.
  const editable = dia.estado === null || dia.estado === "borrador";

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

  const titulo = NOMBRE_DIA.format(new Date(`${dia.fecha}T12:00:00Z`));

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
          <h3 className="text-[12.5px] font-bold capitalize">{titulo}</h3>
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
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg bg-muted px-2 py-1"
                >
                  <span className="w-4 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 basis-[8rem] truncate text-[12px]">
                    {p.tiendaNombre}
                  </span>
                  {editable ? (
                    <span className="flex shrink-0 gap-1">
                      <BotonOrden
                        etiqueta={`Subir ${p.tiendaNombre}`}
                        simbolo="↑"
                        inactivo={pendiente || i === 0}
                        onClick={() =>
                          ejecutar(
                            () =>
                              reordenarParadas({
                                ruteroId: dia.ruteroId,
                                paradas: moverParada(dia.paradas, p.id, -1),
                              }),
                            `${p.tiendaNombre} sube a la posición ${i}`,
                          )
                        }
                      />
                      <BotonOrden
                        etiqueta={`Bajar ${p.tiendaNombre}`}
                        simbolo="↓"
                        inactivo={pendiente || i === dia.paradas.length - 1}
                        onClick={() =>
                          ejecutar(
                            () =>
                              reordenarParadas({
                                ruteroId: dia.ruteroId,
                                paradas: moverParada(dia.paradas, p.id, 1),
                              }),
                            `${p.tiendaNombre} baja a la posición ${i + 2}`,
                          )
                        }
                      />
                      <BotonOrden
                        etiqueta={`Quitar ${p.tiendaNombre}`}
                        simbolo="×"
                        inactivo={pendiente}
                        onClick={() => {
                          // La fila entera —y con ella este botón— desaparece del
                          // DOM. Sin mover el foco a mano, el navegador lo manda a
                          // `<body>` y quien navega con teclado pierde el sitio.
                          selectorTienda.current?.focus();
                          ejecutar(
                            () => quitarParada({ paradaId: p.id }),
                            `${p.tiendaNombre} quitada de la ruta`,
                          );
                        }}
                      />
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}

          {editable ? (
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

          {/* El éxito es invisible para quien no ve la lista cambiar. */}
          <p aria-live="polite" className="sr-only">
            {anuncio}
          </p>
        </>
      ) : null}
    </section>
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
