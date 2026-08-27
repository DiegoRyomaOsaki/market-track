"use client";

import { usePathname } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { useCerrarAlSalir } from "@/components/panel/use-cerrar";
import { itemPortalActivo } from "@/lib/portal/nav";

// El header del portal: título de la sección activa, ayuda contextual (?) y el
// nombre del cliente (su marca) a la derecha. Reusa el hook de cierre del panel.
export function HeaderPortal({ cliente }: { cliente: string }) {
  const item = itemPortalActivo(usePathname());
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const cerrar = useCallback(() => {
    setAbierto(false);
    triggerRef.current?.focus();
  }, []);
  useCerrarAlSalir(ref, abierto, cerrar);

  const titulo = item?.titulo ?? "Portal";

  return (
    <header className="sticky top-0 z-30 flex h-[60px] flex-none items-center gap-4 border-b border-border bg-background px-6 print:hidden">
      <div className="min-w-0 flex-1">
        <h1 className="text-base font-bold tracking-tight">{titulo}</h1>
        {item?.subtitulo && (
          <div className="truncate text-[11.5px] text-muted-foreground">
            {item.subtitulo}
          </div>
        )}
      </div>

      <div className="relative" ref={ref}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-expanded={abierto}
          aria-haspopup="dialog"
          title="Ayuda de esta sección"
          className="flex size-[34px] items-center justify-center rounded-[9px] border border-border bg-background text-sm font-bold text-muted-foreground hover:bg-muted"
        >
          ?
        </button>
        {abierto && (
          <div
            role="dialog"
            aria-label={`Ayuda — ${titulo}`}
            className="absolute right-0 top-11 z-50 w-[340px] rounded-xl bg-popover p-4 text-[12.5px] leading-relaxed text-popover-foreground shadow-2xl"
          >
            <div className="mb-1 font-bold">{titulo}</div>
            <div className="text-popover-foreground/70">
              {item?.ayuda ?? "Elige una sección para ver su ayuda."}
            </div>
            <button
              type="button"
              onClick={cerrar}
              className="mt-3 h-[30px] rounded-md bg-popover-foreground/15 px-3 text-xs font-semibold text-popover-foreground hover:bg-popover-foreground/25"
            >
              Entendido
            </button>
          </div>
        )}
      </div>

      <span className="truncate text-[12.5px] font-semibold text-muted-foreground">
        {cliente}
      </span>
    </header>
  );
}
