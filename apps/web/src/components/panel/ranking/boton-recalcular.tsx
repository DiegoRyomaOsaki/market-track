"use client";

import { useState, useTransition } from "react";

import { botonSecundario } from "@/components/panel/estilos";
import {
  recalcularPeriodo,
  type ResultadoRecalculo,
} from "@/lib/ranking/acciones";

// El disparador del motor, a mano. Existe porque nadie más lo dispara todavía:
// sin él, el ranking nace vacío en producción. El resultado enseña también los
// BLOQUEADOS — es la única ventana del panel al guardarraíl de fotos sin
// verificar, y un bloqueo que nadie ve es indistinguible de un periodo que
// todavía no tocaba cerrar.

export function BotonRecalcular({
  tipo,
  inicio,
}: {
  tipo: string;
  inicio: string;
}) {
  const [pendiente, empezar] = useTransition();
  const [resultado, setResultado] = useState<ResultadoRecalculo | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className={botonSecundario}
        disabled={pendiente}
        onClick={() =>
          empezar(async () => {
            setResultado(await recalcularPeriodo(tipo, inicio));
          })
        }
      >
        {pendiente ? "Recalculando…" : "Recalcular periodo"}
      </button>
      {/* Montado desde el primer render: solo cambia su texto. */}
      <span aria-live="polite" className="text-[12.5px] text-muted-foreground">
        {resultado === null
          ? ""
          : resultado.ok
            ? `${resultado.procesados} recalculados` +
              (resultado.bloqueados > 0
                ? ` · ${resultado.bloqueados} sin cerrar por fotos sin verificar`
                : "")
            : resultado.error}
      </span>
    </div>
  );
}
