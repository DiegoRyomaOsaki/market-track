"use client";

import { useState, useTransition } from "react";

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

const ESTILO_ESTADO = {
  borrador: "bg-en-curso-suave text-en-curso-texto",
  publicado: "bg-completado-suave text-completado-texto",
  en_curso: "bg-en-curso-suave text-en-curso-texto",
  completado: "bg-muted text-muted-foreground",
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
  const [pendiente, iniciar] = useTransition();
  const [abierto, setAbierto] = useState(!compacto);

  // Un rutero que ya empezó no se replanifica desde aquí: el mercaderista está
  // en la calle con él.
  const editable = dia.estado === null || dia.estado === "borrador";

  function ejecutar(accion: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    iniciar(async () => {
      const r = await accion();
      if (!r.ok) setError(r.error ?? "No se pudo guardar el cambio");
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
                  className="flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1"
                >
                  <span className="w-4 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px]">
                    {p.tiendaNombre}
                  </span>
                  {editable ? (
                    <>
                      <BotonOrden
                        etiqueta={`Subir ${p.tiendaNombre}`}
                        simbolo="↑"
                        disabled={pendiente || i === 0}
                        onClick={() =>
                          ejecutar(() =>
                            reordenarParadas({
                              ruteroId: dia.ruteroId,
                              paradas: moverParada(dia.paradas, p.id, -1),
                            }),
                          )
                        }
                      />
                      <BotonOrden
                        etiqueta={`Bajar ${p.tiendaNombre}`}
                        simbolo="↓"
                        disabled={pendiente || i === dia.paradas.length - 1}
                        onClick={() =>
                          ejecutar(() =>
                            reordenarParadas({
                              ruteroId: dia.ruteroId,
                              paradas: moverParada(dia.paradas, p.id, 1),
                            }),
                          )
                        }
                      />
                      <BotonOrden
                        etiqueta={`Quitar ${p.tiendaNombre}`}
                        simbolo="×"
                        disabled={pendiente}
                        onClick={() =>
                          ejecutar(() => quitarParada({ paradaId: p.id }))
                        }
                      />
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
          )}

          {editable ? (
            <label className="flex flex-col gap-1">
              <span className="sr-only">Añadir tienda al {titulo}</span>
              <select
                value=""
                disabled={pendiente}
                onChange={(e) => {
                  const tiendaId = e.target.value;
                  if (!tiendaId) return;
                  ejecutar(() =>
                    agregarParada({
                      mercaderistaId,
                      fecha: dia.fecha,
                      tiendaId,
                    }),
                  );
                }}
                className="min-h-11 rounded-lg border border-border bg-background px-2 text-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
              >
                <option value="">+ Añadir tienda…</option>
                {tiendas.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {sePuedePublicar(dia) ? (
            <button
              type="button"
              disabled={pendiente}
              onClick={() =>
                ejecutar(() => publicarRutero({ ruteroId: dia.ruteroId }))
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
        </>
      ) : null}
    </section>
  );
}

function BotonOrden({
  etiqueta,
  simbolo,
  disabled,
  onClick,
}: {
  etiqueta: string;
  simbolo: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // El símbolo es decorativo: lo que se lee es la etiqueta, que dice qué
      // parada se mueve y hacia dónde.
      aria-label={etiqueta}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-border text-[12px] hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-30"
    >
      <span aria-hidden="true">{simbolo}</span>
    </button>
  );
}
