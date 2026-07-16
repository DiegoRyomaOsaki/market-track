"use client";

import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

import { itemActivo } from "@/lib/panel/navegacion";

import { useCerrarAlSalir } from "./use-cerrar";

// La ayuda contextual (`?`) de cada sección. Aquí queda el shell del popover; el
// CONTENIDO por sección se completa en su ticket. La ayuda viaja con la app (no
// se descarga): el texto es estático, nunca una consulta.
export function HelpPopover() {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const item = itemActivo(usePathname());
  useCerrarAlSalir(ref, abierto, () => setAbierto(false));

  return (
    <div className="relative" ref={ref}>
      <button
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
          <div className="text-white/70">
            La ayuda contextual de esta sección se añade próximamente.
          </div>
          <button
            type="button"
            onClick={() => setAbierto(false)}
            className="mt-3 h-[30px] rounded-md bg-white/15 px-3 text-xs font-semibold text-white hover:bg-white/25"
          >
            Entendido
          </button>
        </div>
      )}
    </div>
  );
}
