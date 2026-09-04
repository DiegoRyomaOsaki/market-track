"use client";

import { useRef, useState, useTransition } from "react";

import { Pastilla } from "@/components/panel/tabla";
import { revisarVisita } from "@/lib/panel/acciones-revision";
import {
  estiloDecision,
  etiquetaDecision,
  type DecisionRevision,
} from "@/lib/panel/revision";

// Aprobar o rechazar el reporte. Rechazar exige motivo: ese texto es lo único que
// le dice al mercaderista qué corregir, y lo lee en su app.

const FECHA_LARGA = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Lima",
});

const ID_ERROR = "motivo-error";

export type RevisionActual = {
  decision: DecisionRevision;
  motivo: string | null;
  revisorNombre: string | null;
  revisadoAt: string;
};

export function DecisionRevision({
  visitaId,
  revisionInicial,
  evidenciaPendiente,
}: {
  visitaId: string;
  revisionInicial: RevisionActual | null;
  /** Cuántas fotos siguen en el teléfono: se avisa, no se bloquea. */
  evidenciaPendiente: number;
}) {
  const [revision, setRevision] = useState(revisionInicial);
  const [motivo, setMotivo] = useState(revisionInicial?.motivo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  const resumen = useRef<HTMLParagraphElement>(null);
  const campoMotivo = useRef<HTMLTextAreaElement>(null);

  function decidir(decision: DecisionRevision) {
    // Se valida aquí, en la acción y en la base. Aquí es para no gastar un viaje
    // y para poder señalar el campo.
    if (decision === "rechazada" && motivo.trim() === "") {
      setError("Explica por qué se rechaza: el mercaderista lee este texto.");
      // El foco va al campo que hay que corregir, no se queda en el botón: si no,
      // quien navega con teclado tiene que buscar a mano cuál era el problema.
      campoMotivo.current?.focus();
      return;
    }
    setError(null);
    iniciar(async () => {
      const r = await revisarVisita({
        visitaId,
        decision,
        motivo: motivo.trim(),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setRevision({
        decision,
        motivo: motivo.trim() === "" ? null : motivo.trim(),
        revisorNombre: r.revisorNombre,
        revisadoAt: r.revisadoAt,
      });
      // Tras decidir, lo que importa es el resultado: se lleva el foco ahí para
      // que un lector de pantalla lo anuncie en vez de dejarlo en un botón que
      // ahora dice otra cosa.
      resumen.current?.focus();
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-bold">Decisión</h2>
        {revision ? (
          <Pastilla tono={estiloDecision(revision.decision)}>
            {etiquetaDecision(revision.decision)}
          </Pastilla>
        ) : (
          <Pastilla tono={estiloDecision(null)}>
            {etiquetaDecision(null)}
          </Pastilla>
        )}
      </div>

      <p
        ref={resumen}
        tabIndex={-1}
        aria-live="polite"
        className="text-[12px] text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {revision
          ? `${etiquetaDecision(revision.decision)} por ${revision.revisorNombre ?? "—"} el ${FECHA_LARGA.format(new Date(revision.revisadoAt))}.`
          : "Este reporte todavía no se ha revisado."}
      </p>

      {evidenciaPendiente > 0 ? (
        <p className="rounded-lg bg-en-curso-suave px-3 py-2 text-[11.5px] text-en-curso-texto">
          {evidenciaPendiente === 1
            ? "Queda 1 foto sin subir desde el teléfono: aún no se puede ver."
            : `Quedan ${evidenciaPendiente} fotos sin subir desde el teléfono: aún no se pueden ver.`}{" "}
          Se puede decidir igual, pero sin esa evidencia.
        </p>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-semibold">
          Motivo{" "}
          <span className="font-normal text-muted-foreground">
            (obligatorio al rechazar)
          </span>
        </span>
        <textarea
          ref={campoMotivo}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          maxLength={500}
          rows={3}
          disabled={pendiente}
          // Sin esto, el error se anuncia una vez al aparecer y desaparece: al
          // volver al campo para corregirlo, un lector de pantalla ya no dice ni
          // que es inválido ni por qué.
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : ID_ERROR}
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
          placeholder="Qué falta o qué está mal. Lo lee el mercaderista en su app."
        />
      </label>

      <div className="flex flex-wrap gap-2">
        {/* Los botones NO se deshabilitan para forzar el motivo: uno deshabilitado
            no se enfoca y no explica por qué. Se pulsa y se explica. */}
        <button
          type="button"
          disabled={pendiente}
          onClick={() => decidir("aprobada")}
          className="min-h-11 rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
        >
          {pendiente ? "Guardando…" : "Aprobar"}
        </button>
        <button
          type="button"
          disabled={pendiente}
          onClick={() => decidir("rechazada")}
          className="min-h-11 rounded-lg border border-border px-3 text-[12px] font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
        >
          Rechazar
        </button>
      </div>

      {error ? (
        <p
          id={ID_ERROR}
          role="alert"
          className="text-[11.5px] text-alerta-texto"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
