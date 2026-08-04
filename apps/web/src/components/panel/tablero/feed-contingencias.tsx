"use client";

import { useTransition } from "react";

import { marcarContingenciaAtendida } from "@/lib/panel/acciones-tablero";
import { sinAtender, type Contingencia } from "@/lib/panel/tablero";
import { cn } from "@/lib/utils";

// El feed de contingencias en vivo. Una contingencia es el bypass del
// levantamiento: el mercaderista no pudo completar un paso, siguió adelante y
// dejó el motivo. El supervisor las ve llegar y las cierra desde aquí.
//
// La suscripción de Realtime vive en el componente padre; esto solo pinta y
// dispara la acción.

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Lima",
  });
}

export function FeedContingencias({
  contingencias,
  onAtendida,
}: {
  contingencias: Contingencia[];
  /** Se llama al confirmar el servidor, para que el padre baje el badge. */
  onAtendida: (id: string) => void;
}) {
  const pendientes = sinAtender(contingencias);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-bold">Contingencias de hoy</h2>
        {/* El badge no es solo un número de color: `aria-live` hace que el lector
            de pantalla anuncie la contingencia que entra sin recargar. */}
        <span
          aria-live="polite"
          className={cn(
            "inline-flex min-w-6 justify-center rounded-full px-2 py-0.5 text-[11.5px] font-bold",
            pendientes > 0
              ? "bg-alerta-suave text-alerta-texto"
              : "bg-muted text-muted-foreground",
          )}
        >
          {pendientes === 0 ? "Sin pendientes" : `${pendientes} sin atender`}
        </span>
      </div>

      {contingencias.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Ninguna contingencia hoy. El levantamiento va completo.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {contingencias.map((c) => (
            <Fila key={c.id} contingencia={c} onAtendida={onAtendida} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Fila({
  contingencia,
  onAtendida,
}: {
  contingencia: Contingencia;
  onAtendida: (id: string) => void;
}) {
  const [pendiente, iniciar] = useTransition();
  const atendida = contingencia.estado === "resuelta";

  function atender() {
    iniciar(async () => {
      const r = await marcarContingenciaAtendida({ id: contingencia.id });
      if (r.ok) onAtendida(contingencia.id);
    });
  }

  return (
    <li className="flex items-start gap-2.5 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold">
          {contingencia.tienda_nombre} · paso {contingencia.paso}
        </div>
        <div className="text-[11.5px] text-muted-foreground">
          {contingencia.mercaderista_nombre} · {hora(contingencia.creado_at)}
        </div>
        <p className="mt-1 text-[12.5px]">{contingencia.motivo}</p>
      </div>
      {atendida ? (
        <span className="shrink-0 rounded-full bg-completado-suave px-2.5 py-0.5 text-[11.5px] font-bold text-completado-texto">
          Atendida
        </span>
      ) : (
        <button
          type="button"
          onClick={atender}
          disabled={pendiente}
          className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-[11.5px] font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
        >
          {pendiente ? "Marcando…" : "Marcar atendida"}
        </button>
      )}
    </li>
  );
}
