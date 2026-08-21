"use client";

import { useEffect, useId, useRef, useState } from "react";

import { campo, etiqueta as claseEtiqueta } from "@/components/panel/campos";

// Un buscador de catálogo: en vez de precargar miles de <option>, teclea y el
// servidor devuelve hasta 20 coincidencias. Es la pieza que sustituye a los
// <select> de SKU y tienda — los dos catálogos que siguen siendo grandes aun
// acotados a un cliente.
//
// El id elegido viaja en un <input hidden>, así que el submit por FormData de
// los formularios no cambia. Para un multi-selección, el padre pasa `alElegir`
// y `limpiarAlElegir` y guarda él la lista.

export type OpcionBusqueda = {
  id: string;
  etiqueta: string;
  tenant_id: string;
};

export type ResultadoBusquedaOpciones =
  { ok: true; opciones: OpcionBusqueda[] } | { ok: false; error: string };

const RETARDO_MS = 250;

export function BuscadorOpcion({
  etiqueta,
  nombreCampo,
  placeholder,
  buscar,
  tenantId,
  valorInicial = null,
  alElegir,
  limpiarAlElegir = false,
}: {
  etiqueta: string;
  /** Nombre del input oculto con el id elegido. Sin él, no viaja en el form. */
  nombreCampo?: string;
  placeholder?: string;
  /**
   * Una Server Action de `buscar-opciones.ts`, con el tenant como argumento
   * aparte y no en un closure: un Server Component no puede serializar una
   * función creada al vuelo, solo la referencia a la acción.
   */
  buscar: (
    q: string,
    tenantId: string | null,
  ) => Promise<ResultadoBusquedaOpciones>;
  /** El cliente al que se acota la búsqueda; `null` = sin acotar. */
  tenantId: string | null;
  /**
   * La opción ya guardada, resuelta POR ID por la página (no por búsqueda: un
   * SKU desactivado no aparece en los resultados y el campo se vería vacío —
   * y un submit sin tocarlo lo cambiaría en silencio).
   */
  valorInicial?: OpcionBusqueda | null;
  alElegir?: (opcion: OpcionBusqueda | null) => void;
  limpiarAlElegir?: boolean;
}) {
  const [texto, setTexto] = useState(valorInicial?.etiqueta ?? "");
  const [elegido, setElegido] = useState<OpcionBusqueda | null>(valorInicial);
  const [opciones, setOpciones] = useState<OpcionBusqueda[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [activa, setActiva] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const idLista = useId();
  // Descarta respuestas fuera de orden: la búsqueda de "né" puede volver
  // después que la de "néctar" y pisaría los resultados buenos.
  const secuencia = useRef(0);

  useEffect(() => {
    // No se re-busca lo ya elegido: el texto quedó puesto por la selección.
    if (texto === "" || texto === elegido?.etiqueta) {
      setOpciones([]);
      setAbierto(false);
      setError(null);
      return;
    }
    const timer = setTimeout(() => {
      const mia = ++secuencia.current;
      buscar(texto, tenantId)
        .then((r) => {
          if (mia !== secuencia.current) return;
          if (r.ok) {
            setOpciones(r.opciones);
            setError(null);
          } else {
            setOpciones([]);
            setError(r.error);
          }
          setActiva(-1);
          setAbierto(true);
        })
        .catch(() => {
          if (mia !== secuencia.current) return;
          setOpciones([]);
          setError("No se pudo buscar. Reintenta.");
          setAbierto(true);
        });
    }, RETARDO_MS);
    return () => clearTimeout(timer);
  }, [texto, elegido, buscar, tenantId]);

  function elegir(opcion: OpcionBusqueda) {
    setElegido(limpiarAlElegir ? null : opcion);
    setTexto(limpiarAlElegir ? "" : opcion.etiqueta);
    setAbierto(false);
    setOpciones([]);
    alElegir?.(opcion);
  }

  function alEscribir(valor: string) {
    setTexto(valor);
    if (elegido !== null && valor !== elegido.etiqueta) {
      setElegido(null);
      alElegir?.(null);
    }
  }

  function alTeclear(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setAbierto(false);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (opciones.length === 0) return;
      setAbierto(true);
      const paso = e.key === "ArrowDown" ? 1 : -1;
      setActiva((a) => (a + paso + opciones.length) % opciones.length);
      return;
    }
    if (e.key === "Enter" && abierto && activa >= 0) {
      // Elegir, no enviar el formulario: el Enter del combobox es selección.
      e.preventDefault();
      const opcion = opciones[activa];
      if (opcion) elegir(opcion);
    }
  }

  const anuncio =
    error ??
    (abierto
      ? opciones.length === 0
        ? "Sin resultados"
        : `${opciones.length} resultados`
      : "");

  return (
    <div
      className="relative flex flex-col gap-1.5"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setAbierto(false);
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className={claseEtiqueta}>{etiqueta}</span>
        <input
          type="text"
          role="combobox"
          aria-expanded={abierto}
          aria-controls={idLista}
          aria-activedescendant={
            activa >= 0 ? `${idLista}-${activa}` : undefined
          }
          aria-autocomplete="list"
          autoComplete="off"
          value={texto}
          placeholder={placeholder}
          onChange={(e) => alEscribir(e.target.value)}
          onKeyDown={alTeclear}
          className={campo}
        />
      </label>
      {nombreCampo && (
        <input type="hidden" name={nombreCampo} value={elegido?.id ?? ""} />
      )}
      {/* Montada desde el primer render: un aria-live que aparece con el
          resultado se anuncia a medias o no se anuncia. Solo cambia su texto. */}
      <span aria-live="polite" className="sr-only">
        {anuncio}
      </span>
      {abierto && (
        <ul
          role="listbox"
          id={idLista}
          aria-label={etiqueta}
          className="absolute top-full z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-[9px] border border-border bg-background py-1 shadow-md"
        >
          {error !== null ? (
            <li className="px-3 py-1.5 text-[13px] text-muted-foreground">
              {error}
            </li>
          ) : opciones.length === 0 ? (
            <li className="px-3 py-1.5 text-[13px] text-muted-foreground">
              Sin resultados
            </li>
          ) : (
            opciones.map((o, i) => (
              <li
                key={o.id}
                id={`${idLista}-${i}`}
                role="option"
                aria-selected={i === activa}
                // onMouseDown y no onClick: el click dispara primero el blur
                // del input, que cierra la lista antes de que el click llegue.
                onMouseDown={(e) => {
                  e.preventDefault();
                  elegir(o);
                }}
                className={`cursor-pointer px-3 py-1.5 text-[13px] ${
                  i === activa ? "bg-muted" : "hover:bg-muted"
                }`}
              >
                {o.etiqueta}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
