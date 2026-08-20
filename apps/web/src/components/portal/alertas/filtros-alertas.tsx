"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  ESTADOS_ALERTA,
  SEVERIDADES_ALERTA,
  TIPOS_ALERTA_CLIENTE,
} from "@market-track/shared";

import {
  ETIQUETA_ESTADO,
  ETIQUETA_SEVERIDAD,
  ETIQUETA_TIPO_ALERTA,
} from "@/lib/portal/alertas";

// Los filtros propios de la bandeja: tipo · severidad · estado.
//
// Fuera de `FiltrosGlobales` a propósito: ese contrato lo comparten las cuatro
// secciones y las RPC del dashboard no saben recibir un tipo de alerta.
//
// Formulario con "Aplicar" y no navegación por cada `onChange`: un `<select>`
// cerrado emite `change` en cada flecha del teclado, así que recorrer la lista
// dispararía una navegación por opción.

const CAMPO =
  "min-h-11 rounded-lg border border-border bg-background px-2 text-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const CAMPOS = [
  {
    nombre: "tipo",
    etiqueta: "Tipo",
    valores: TIPOS_ALERTA_CLIENTE,
    rotulo: ETIQUETA_TIPO_ALERTA,
  },
  {
    nombre: "severidad",
    etiqueta: "Severidad",
    valores: SEVERIDADES_ALERTA,
    rotulo: ETIQUETA_SEVERIDAD,
  },
  {
    nombre: "estado",
    etiqueta: "Estado",
    valores: ESTADOS_ALERTA,
    rotulo: ETIQUETA_ESTADO,
  },
] as const;

export function FiltrosAlertas({
  valores,
}: {
  valores: {
    tipo: string | null;
    severidad: string | null;
    estado: string | null;
  };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function aplicar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    // Se parte de los params vigentes para NO borrar los filtros globales
    // (fechas, cadena, tienda), que vive en la misma URL.
    const next = new URLSearchParams(params.toString());

    for (const { nombre } of CAMPOS) {
      // `FormData.get` puede devolver un File; solo un texto es un filtro.
      const bruto = datos.get(nombre);
      const v = typeof bruto === "string" ? bruto : "";
      if (v) next.set(nombre, v);
      else next.delete(nombre);
    }
    // Cambiar el filtro vuelve a la primera página: la 5 del resultado anterior
    // puede no existir en el nuevo.
    next.delete("pagina");

    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function limpiar() {
    const next = new URLSearchParams(params.toString());
    for (const { nombre } of CAMPOS) next.delete(nombre);
    next.delete("pagina");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <form
      onSubmit={aplicar}
      className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-background p-3"
    >
      {CAMPOS.map(({ nombre, etiqueta, valores: opciones, rotulo }) => (
        <label key={nombre} className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold">{etiqueta}</span>
          <select
            name={nombre}
            defaultValue={valores[nombre] ?? ""}
            className={CAMPO}
          >
            <option value="">Todas</option>
            {opciones.map((v) => (
              <option key={v} value={v}>
                {(rotulo as Record<string, string>)[v]}
              </option>
            ))}
          </select>
        </label>
      ))}

      <button
        type="submit"
        className="min-h-11 rounded-lg bg-primary px-4 text-[12px] font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Aplicar
      </button>
      <button
        type="button"
        onClick={limpiar}
        className="min-h-11 rounded-lg border border-border px-4 text-[12px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Limpiar
      </button>
    </form>
  );
}
