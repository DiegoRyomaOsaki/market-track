"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { TIPOS_FOTO_PORTAL } from "@market-track/shared";

import { ETIQUETA_FOTO } from "@/components/evidencia/foto-evidencia";

// El filtro de tipo de foto. Vive en la URL como los globales —así la vista se
// comparte por enlace— pero fuera de `FiltrosGlobales`: un "tipo de foto" no
// significa nada sobre unos KPI ni sobre una alerta.
//
// Se navega con `replace` y no con `push`: un `<select>` cerrado emite `change`
// en CADA flecha del teclado, así que recorrer la lista con `push` dejaría un
// rastro de entradas que el botón "atrás" tendría que deshacer una a una.

export function FiltroTipoFoto({ valor }: { valor: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function elegir(tipo: string) {
    const next = new URLSearchParams(params.toString());
    if (tipo) next.set("tipo", tipo);
    else next.delete("tipo");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[11.5px] font-semibold">Tipo de foto</span>
      <select
        value={valor ?? ""}
        onChange={(e) => elegir(e.target.value)}
        className="min-h-11 rounded-lg border border-border bg-background px-2 text-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <option value="">Todas</option>
        {TIPOS_FOTO_PORTAL.map((t) => (
          <option key={t} value={t}>
            {ETIQUETA_FOTO[t]}
          </option>
        ))}
      </select>
    </label>
  );
}
