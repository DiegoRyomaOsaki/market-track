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

  const vencido = restante === "00:00";

  return (
    <div className="flex flex-col gap-2">
      {/* UNA sola región, montada desde el primer render: si apareciera al
          generar o al vencer, algunos lectores de pantalla no la registrarían —
          justo en el momento que más importa. Solo cambia su texto. */}
      <p role="status" className="sr-only">
        {vencido
          ? "El pase venció"
          : `Pase generado. El código se muestra en pantalla y vence en ${restante}`}
      </p>

      {vencido ? (
        <p className="text-[13px] text-muted-foreground">
          El pase venció. Si todavía hace falta, genera otro.
        </p>
      ) : (
        <div className="flex flex-col gap-2 rounded-xl border border-en-curso-texto bg-en-curso-suave p-4">
          <p className="text-[12px] font-semibold text-en-curso-texto">
            Dicta este código. No se puede volver a ver.
          </p>
          {/* Agrupado de tres en tres: se dicta por teléfono y un bloque de seis
              cifras seguidas se repite mal. */}
          <p className="font-mono text-[30px] font-bold tracking-[0.3em] text-en-curso-texto">
            {codigo.slice(0, 3)} {codigo.slice(3)}
          </p>
          <p className="text-[12px] text-en-curso-texto">
            {/* `aria-live="off"`: con un anuncio por segundo taparía todo lo
                demás. El vencimiento sí se anuncia, en la región de arriba. */}
            Vence en <span aria-live="off">{restante}</span>
          </p>
        </div>
      )}
    </div>
  );
}
