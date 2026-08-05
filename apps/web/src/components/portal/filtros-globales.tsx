"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { FormEvent } from "react";

import { campo, etiqueta } from "@/components/panel/campos";
import { botonSecundario } from "@/components/panel/estilos";

type Cadena = { id: string; nombre: string };
type Tienda = { id: string; nombre: string; cadena_id: string | null };

const CLAVES = ["desde", "hasta", "cadena", "tienda"] as const;

// La barra de filtros GLOBALES del portal (rango de fechas · cadena · tienda).
// Viven en la URL: al pulsar "Aplicar" se reescriben los searchParams conservando
// la ruta, y cada página los lee en el servidor. Se navega SOLO al enviar (no en
// cada `onChange`), para no disparar una navegación por cada tecla en un `select`
// (antipatrón de menú de salto, WCAG 3.2.2). El `key` remonta el formulario cuando
// cambia la URL (al limpiar o con atrás/adelante) para re-sembrar los controles.
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

  const valor = (clave: string) => params.get(clave) ?? "";
  const hayFiltros = CLAVES.some((c) => valor(c) !== "");

  function aplicar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    // Se parte de lo que ya hay en la URL, no de cero: cada sección puede tener
    // filtros propios (el tipo de foto de la galería) y aplicar los globales no
    // debe borrárselos.
    const next = new URLSearchParams(params.toString());
    for (const clave of CLAVES) {
      const v = datos.get(clave);
      if (typeof v === "string" && v) next.set(clave, v);
      else next.delete(clave);
    }
    const qs = next.toString();
    // `scroll: false`: aplicar un filtro no debe saltar el scroll de la vista.
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <form
      key={params.toString()}
      onSubmit={aplicar}
      className="flex flex-wrap items-end gap-3 border-b border-border bg-background px-6 py-3"
    >
      <label className="flex flex-col gap-1">
        <span className={etiqueta}>Desde</span>
        <input
          type="date"
          name="desde"
          defaultValue={valor("desde")}
          className={campo}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={etiqueta}>Hasta</span>
        <input
          type="date"
          name="hasta"
          defaultValue={valor("hasta")}
          className={campo}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={etiqueta}>Cadena</span>
        <select name="cadena" defaultValue={valor("cadena")} className={campo}>
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
        <select name="tienda" defaultValue={valor("tienda")} className={campo}>
          <option value="">Todas</option>
          {tiendas.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
            </option>
          ))}
        </select>
      </label>

      <button type="submit" className={botonSecundario}>
        Aplicar
      </button>
      {hayFiltros ? (
        <button
          type="button"
          onClick={() => router.push(pathname, { scroll: false })}
          className="h-[38px] text-[13px] font-semibold text-muted-foreground hover:underline"
        >
          Limpiar
        </button>
      ) : null}
    </form>
  );
}
