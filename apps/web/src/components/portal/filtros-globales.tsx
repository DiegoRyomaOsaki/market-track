"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { campo, etiqueta } from "@/components/panel/campos";

type Cadena = { id: string; nombre: string };
type Tienda = { id: string; nombre: string; cadena_id: string | null };

// La barra de filtros GLOBALES del portal (rango de fechas · cadena · tienda).
// Vive en la URL: al cambiar, reescribe los searchParams conservando la ruta, y
// cada página los lee en el servidor. Las opciones vienen del layout (RLS ya las
// acota al cliente).
export function FiltrosGlobales({
  cadenas,
  tiendas,
}: {
  cadenas: Cadena[];
  tiendas: Tienda[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();

  const desde = params.get("desde") ?? "";
  const hasta = params.get("hasta") ?? "";
  const cadena = params.get("cadena") ?? "";
  const tienda = params.get("tienda") ?? "";

  function actualizar(cambios: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor) next.set(clave, valor);
      else next.delete(clave);
    }
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  // La tienda se acota a la cadena elegida; cambiar de cadena limpia la tienda.
  const tiendasVisibles = cadena
    ? tiendas.filter((t) => t.cadena_id === cadena)
    : tiendas;
  const hayFiltros = Boolean(desde || hasta || cadena || tienda);

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border bg-background px-6 py-3">
      <label className="flex flex-col gap-1">
        <span className={etiqueta}>Desde</span>
        <input
          type="date"
          value={desde}
          max={hasta || undefined}
          onChange={(e) => actualizar({ desde: e.target.value })}
          className={campo}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={etiqueta}>Hasta</span>
        <input
          type="date"
          value={hasta}
          min={desde || undefined}
          onChange={(e) => actualizar({ hasta: e.target.value })}
          className={campo}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={etiqueta}>Cadena</span>
        <select
          value={cadena}
          onChange={(e) => actualizar({ cadena: e.target.value, tienda: "" })}
          className={campo}
        >
          <option value="">Todas</option>
          {cadenas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={etiqueta}>Tienda</span>
        <select
          value={tienda}
          onChange={(e) => actualizar({ tienda: e.target.value })}
          className={campo}
        >
          <option value="">Todas</option>
          {tiendasVisibles.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
            </option>
          ))}
        </select>
      </label>
      {hayFiltros ? (
        <button
          type="button"
          onClick={() => router.push(pathname)}
          className="h-[38px] text-[13px] font-semibold text-muted-foreground hover:underline"
        >
          Limpiar
        </button>
      ) : null}
    </div>
  );
}
