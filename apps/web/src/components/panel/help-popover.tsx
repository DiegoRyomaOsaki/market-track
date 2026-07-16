"use client";

import { usePathname } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { itemActivo } from "@/lib/panel/navegacion";

import { useCerrarAlSalir } from "./use-cerrar";

// La ayuda contextual (`?`) de cada sección. Aquí queda el shell del popover; el
// CONTENIDO por sección se completa en su ticket. La ayuda viaja con la app (no
// se descarga): el texto es estático, nunca una consulta.
export function HelpPopover() {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const item = itemActivo(usePathname());

  // Al cerrar, el foco vuelve al disparador: un usuario de teclado no lo pierde.
  const cerrar = useCallback(() => {
    setAbierto(false);
    triggerRef.current?.focus();
  }, []);
  useCerrarAlSalir(ref, abierto, cerrar);

  return (
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
          aria-label={`Ayuda — ${item?.titulo ?? "Panel"}`}
          className="absolute right-0 top-11 z-50 w-[340px] rounded-xl bg-popover p-4 text-[12.5px] leading-relaxed text-popover-foreground shadow-2xl"
        >
          <div className="mb-1 font-bold">{item?.titulo ?? "Panel"}</div>
          <div className="text-popover-foreground/70">
            La ayuda contextual de esta sección se añade próximamente.
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
  );
}
