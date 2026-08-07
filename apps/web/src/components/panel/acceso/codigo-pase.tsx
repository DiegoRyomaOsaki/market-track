"use client";

import { useEffect, useState } from "react";

import { tiempoRestante } from "@/lib/panel/acceso";

// El código recién emitido, con su cuenta atrás.
//
// El código SOLO existe aquí, en el estado de este componente: no va a la URL, ni
// a `localStorage`, ni a un Server Component (acabaría en el payload RSC), ni a
// un log. Al recargar desaparece para siempre — por eso el aviso de "una sola
// vez" va antes de generarlo, no después.

export function CodigoPase({
  codigo,
  expiraAt,
  alVencer,
}: {
  codigo: string;
  expiraAt: string;
  /** Para que la bitácora se refresque y la fila pase a «vencido». */
  alVencer?: () => void;
}) {
  const [restante, setRestante] = useState(() =>
    tiempoRestante(expiraAt, new Date()),
  );

  useEffect(() => {
    // Se recalcula contra `expira_at` en cada tick en vez de decrementar un
    // contador: una pestaña en segundo plano deja de recibir ticks y el número
    // se desviaría del reloj real.
    const id = setInterval(() => {
      const ahora = tiempoRestante(expiraAt, new Date());
      setRestante(ahora);
      if (ahora === "00:00") {
        clearInterval(id);
        alVencer?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [expiraAt, alVencer]);

  if (restante === "00:00") {
    return (
      <p role="status" className="text-[13px] text-muted-foreground">
        El pase venció. Si todavía hace falta, genera otro.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-en-curso-texto bg-en-curso-suave p-4">
      <p className="text-[12px] font-semibold text-en-curso-texto">
        Dicta este código. No se puede volver a ver.
      </p>
      <p className="font-mono text-[30px] font-bold tracking-[0.3em] text-en-curso-texto">
        {codigo}
      </p>
      <p className="text-[12px] text-en-curso-texto">
        {/* `aria-live="off"`: con un anuncio por segundo, un lector de pantalla
            taparía todo lo demás. El vencimiento sí se anuncia, arriba. */}
        Vence en <span aria-live="off">{restante}</span>
      </p>
    </div>
  );
}
