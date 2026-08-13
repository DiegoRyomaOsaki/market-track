"use client";

import { useState, useTransition } from "react";

import type { PreviaPuntaje } from "@/lib/metricas/acciones";
import { LIMITE_VISTA_PREVIA } from "@/lib/metricas/textos";

// El efecto de unos pesos SIN GUARDAR sobre un puntaje real.
//
// Bajo demanda y no en cada tecla: cada pulsación sería una consulta a la base.
//
// La limitación se enseña SIEMPRE, no solo después de calcular: quien cambia el
// objetivo de share of shelf y ve el mismo número tiene que saber por qué antes
// de concluir que la pantalla está rota.

export function VistaPreviaPuntaje({
  onCalcular,
  textoVacio,
  deshabilitado = false,
}: {
  /** Devuelve la previa, o `null` si no hay ningún puntaje que re-ponderar. */
  onCalcular: () => Promise<
    { ok: true; previa: PreviaPuntaje | null } | { ok: false; error: string }
  >;
  textoVacio: string;
  deshabilitado?: boolean;
}) {
  const [pendiente, arrancar] = useTransition();
  const [previa, setPrevia] = useState<PreviaPuntaje | null>(null);
  const [vacio, setVacio] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function calcular() {
    setError(null);
    arrancar(async () => {
      const r = await onCalcular();
      if (!r.ok) {
        setError(r.error);
        setPrevia(null);
        setVacio(false);
        return;
      }
      setPrevia(r.previa);
      setVacio(r.previa === null);
    });
  }

  const delta =
    previa?.actual != null && previa.previsto != null
      ? Number(previa.previsto) - Number(previa.actual)
      : null;

  return (
    <section className="flex flex-col gap-3 rounded-[9px] border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-bold">Vista previa del efecto</h3>
        <button
          type="button"
          onClick={calcular}
          disabled={pendiente || deshabilitado}
          className="h-[34px] rounded-[9px] border border-border bg-background px-3 text-[12.5px] font-semibold hover:bg-muted disabled:opacity-60"
        >
          {pendiente ? "Calculando…" : "Ver efecto"}
        </button>
      </div>

      <p className="text-[11.5px] text-muted-foreground">
        {LIMITE_VISTA_PREVIA}
      </p>

      {/* Región viva montada desde el primer render: si se montara al terminar,
          algunos lectores de pantalla no anunciarían el resultado. */}
      <div aria-live="polite" className="empty:hidden">
        {error ? (
          <p
            role="alert"
            className="rounded-[9px] bg-alerta-suave px-3 py-2 text-[13px] font-semibold text-alerta-texto"
          >
            {error}
          </p>
        ) : vacio ? (
          <p className="text-[12.5px] text-muted-foreground">{textoVacio}</p>
        ) : previa ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-[12.5px] font-semibold">{previa.etiqueta}</p>
            <p className="text-[11.5px] text-muted-foreground">
              {previa.detalle}
            </p>
            <p className="text-[13px]">
              <span className="text-muted-foreground">Ahora </span>
              <strong>{previa.actual ?? "—"}</strong>
              <span className="text-muted-foreground"> → con estos pesos </span>
              <strong>{previa.previsto ?? "—"}</strong>
              {delta !== null ? (
                // El signo va en el TEXTO, no solo en el color: el color por sí
                // solo no comunica la dirección (WCAG 1.4.1).
                <span
                  className={
                    delta >= 0 ? "text-completado-texto" : "text-alerta-texto"
                  }
                >
                  {` (${delta >= 0 ? "sube" : "baja"} ${Math.abs(delta).toFixed(2)})`}
                </span>
              ) : null}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
