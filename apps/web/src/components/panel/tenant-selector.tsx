"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { COOKIE_TENANT } from "@/lib/panel/tenant";
import { cn } from "@/lib/utils";

import { useCerrarAlSalir } from "./use-cerrar";

type Tenant = { id: string; nombre: string };

function inicial(nombre: string): string {
  return (nombre.trim()[0] ?? "?").toUpperCase();
}

// Selector del cliente-marca activo. Persiste el id en una cookie y refresca: el
// resto del panel (Server Components) lee esa cookie para filtrar su vista.
export function TenantSelector({
  tenants,
  actualId,
}: {
  tenants: Tenant[];
  actualId: string | null;
}) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useCerrarAlSalir(ref, abierto, () => setAbierto(false));

  if (tenants.length === 0) return null;
  const actual = tenants.find((t) => t.id === actualId) ?? tenants[0];

  function elegir(id: string) {
    // 1 año, mismo sitio; el valor es solo un id, no dato sensible.
    document.cookie = `${COOKIE_TENANT}=${id}; path=/; max-age=31536000; samesite=lax`;
    setAbierto(false);
    router.refresh();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-haspopup="listbox"
        className="flex h-[38px] items-center gap-2.5 rounded-[9px] border border-border bg-background px-3 text-[13px] font-semibold hover:bg-muted"
      >
        <span className="flex size-5 items-center justify-center rounded bg-primary text-[11px] font-extrabold text-primary-foreground">
          {inicial(actual?.nombre ?? "?")}
        </span>
        {actual?.nombre ?? "—"}
        <span className="text-[10px] text-muted-foreground">▼</span>
      </button>
      {abierto && (
        <div
          role="listbox"
          aria-label="Cliente-marca"
          className="absolute right-0 top-11 z-40 w-[230px] rounded-[10px] border border-border bg-background p-1.5 shadow-xl"
        >
          <div className="px-2 pb-1 pt-1.5 text-[10.5px] font-bold tracking-wide text-muted-foreground">
            CLIENTE-MARCA
          </div>
          {tenants.map((t) => {
            const seleccionado = t.id === actual?.id;
            return (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={seleccionado}
                onClick={() => elegir(t.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] hover:bg-muted",
                  seleccionado && "font-semibold",
                )}
              >
                <span className="flex size-[22px] items-center justify-center rounded bg-primary text-[11px] font-extrabold text-primary-foreground">
                  {inicial(t.nombre)}
                </span>
                <span className="flex-1 text-left">{t.nombre}</span>
                {seleccionado && (
                  <span className="font-extrabold text-primary">✓</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
