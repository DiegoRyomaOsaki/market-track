"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";

import { Avatar, Pastilla } from "@/components/panel/tabla";
import { resolverSolicitud } from "@/lib/panel/acciones-solicitudes";
import {
  estaPendiente,
  etiquetaEstado,
  etiquetaTipo,
  type EstadoSolicitud,
  type Solicitud,
} from "@/lib/panel/solicitudes";

// Una solicitud de la bandeja. Mientras espera decisión muestra el formulario de
// resolución; una vez resuelta, quién decidió qué y con qué comentario.

const ESTILO_ESTADO: Record<EstadoSolicitud, string> = {
  nueva: "bg-alerta-suave text-alerta-texto",
  vista: "bg-en-curso-suave text-en-curso-texto",
  resuelta: "bg-completado-suave text-completado-texto",
  rechazada: "bg-muted text-muted-foreground",
};

function fechaLegible(iso: string): string {
  return new Date(iso).toLocaleString("es-PE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Lima",
  });
}

type Decision = Extract<EstadoSolicitud, "resuelta" | "rechazada">;

export type Resolucion = {
  id: string;
  estado: EstadoSolicitud;
  comentario: string;
  resueltaPorNombre: string;
  resueltaAt: string;
};

export function FilaSolicitud({
  solicitud,
  onResuelta,
}: {
  solicitud: Solicitud;
  onResuelta: (resolucion: Resolucion) => void;
}) {
  const [comentario, setComentario] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  // Cuál de las dos decisiones está en curso. Con un solo booleano compartido, el
  // "Guardando…" salía en el botón que el supervisor NO había pulsado.
  const [enCurso, setEnCurso] = useState<Decision | null>(null);
  const resumen = useRef<HTMLParagraphElement>(null);

  const abierta = estaPendiente(solicitud.estado);

  function resolver(decision: Decision) {
    // Los botones se quedan habilitados y la validación ocurre aquí: un botón
    // deshabilitado no se puede enfocar y no dice POR QUÉ lo está, así que quien
    // navega con teclado pasaba de largo sin enterarse. El aviso va al mismo
    // `role="alert"` que ya usan los errores del servidor.
    if (comentario.trim() === "") {
      setError("Escribe un comentario antes de resolver.");
      return;
    }
    setError(null);
    setEnCurso(decision);
    iniciar(async () => {
      const r = await resolverSolicitud({
        id: solicitud.id,
        decision,
        comentario,
      });
      if (!r.ok) {
        // Fallar en silencio dejaría al supervisor creyendo que ya decidió.
        setError(r.error);
        setEnCurso(null);
        return;
      }
      onResuelta({
        id: solicitud.id,
        estado: decision,
        comentario: comentario.trim(),
        resueltaPorNombre: r.resueltaPorNombre,
        resueltaAt: r.resueltaAt,
      });
      // El formulario que tenía el foco desaparece; sin esto el foco cae al body
      // y quien navega con teclado pierde su sitio en la bandeja.
      requestAnimationFrame(() => resumen.current?.focus());
    });
  }

  return (
    <li className="rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex items-center gap-2">
          <Avatar nombre={solicitud.mercaderista_nombre} />
          <span>
            <span className="block text-[13px] font-semibold">
              {solicitud.mercaderista_nombre}
            </span>
            <span className="block text-[11.5px] text-muted-foreground">
              {etiquetaTipo(solicitud.tipo)} ·{" "}
              {fechaLegible(solicitud.creada_at)}
            </span>
          </span>
        </span>
        <Pastilla tono={ESTILO_ESTADO[solicitud.estado]}>
          {etiquetaEstado(solicitud.estado)}
        </Pastilla>
      </div>

      <p className="mt-2.5 text-[13px]">{solicitud.motivo}</p>

      {abierta ? (
        <div className="mt-3 flex flex-col gap-2">
          <label
            htmlFor={`comentario-${solicitud.id}`}
            className="text-[11.5px] font-semibold"
          >
            Comentario para {solicitud.mercaderista_nombre}
          </label>
          <textarea
            id={`comentario-${solicitud.id}`}
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            rows={2}
            maxLength={500}
            required
            aria-describedby={error ? `error-${solicitud.id}` : undefined}
            className="w-full rounded-lg border border-border bg-background p-2 text-[12.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            placeholder="Qué se decidió y por qué"
          />
          {error ? (
            <p
              id={`error-${solicitud.id}`}
              role="alert"
              className="text-[11.5px] text-alerta-texto"
            >
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => resolver("resuelta")}
              disabled={pendiente}
              className="min-h-11 rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
            >
              {enCurso === "resuelta" ? "Guardando…" : "Aprobar"}
            </button>
            <button
              type="button"
              onClick={() => resolver("rechazada")}
              disabled={pendiente}
              className="min-h-11 rounded-lg border border-border px-3 text-[12px] font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
            >
              {enCurso === "rechazada" ? "Guardando…" : "Rechazar"}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            El comentario es obligatorio: el mercaderista tiene que saber qué se
            decidió sobre su ruta.
          </p>
        </div>
      ) : (
        <div className="mt-3 rounded-lg bg-muted p-2.5">
          <p
            ref={resumen}
            tabIndex={-1}
            className="text-[12.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {etiquetaEstado(solicitud.estado)}
            {solicitud.resuelta_por_nombre
              ? ` por ${solicitud.resuelta_por_nombre}`
              : ""}
            {solicitud.resuelta_at
              ? ` · ${fechaLegible(solicitud.resuelta_at)}`
              : ""}
            {solicitud.comentario_resolucion
              ? ` — ${solicitud.comentario_resolucion}`
              : ""}
          </p>
          {solicitud.estado === "resuelta" ? (
            // El ajuste del rutero en sí es MAR-50; aquí solo se lleva hasta él.
            <Link
              href="/supervisor/ruteros"
              className="mt-1.5 inline-block text-[11.5px] font-semibold underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Ajustar el rutero de {solicitud.mercaderista_nombre}
            </Link>
          ) : null}
        </div>
      )}
    </li>
  );
}
