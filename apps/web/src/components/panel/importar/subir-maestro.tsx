"use client";

import { useRef, useState, useTransition } from "react";

import type { ErrorImportacion } from "@market-track/shared";

import {
  aplicarImportacion,
  validarImportacion,
} from "@/lib/importacion/acciones";

import { TablaErrores } from "./tabla-errores";

// Subir el maestro: previsualizar y, si está limpio, aplicar.
//
// El archivo se guarda en el estado y se manda DOS VECES, una por operación. No
// es un descuido: el servidor no se fía de lo que dijo la previsualización —
// vuelve a leer y validar el archivo, y compara su hash con el revisado—. Si
// aquí se mandara solo el id, esa comprobación no tendría con qué comparar.

type Revision = {
  importacionId: string;
  errores: ErrorImportacion[];
  erroresOmitidos: number;
  resumen: Record<string, number>;
};

export function SubirMaestro({
  tenantId,
  tenantNombre,
}: {
  tenantId: string;
  tenantNombre: string;
}) {
  const [pendiente, arrancar] = useTransition();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [revision, setRevision] = useState<Revision | null>(null);
  const [aplicado, setAplicado] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entradaRef = useRef<HTMLInputElement>(null);

  function elegir(e: React.ChangeEvent<HTMLInputElement>) {
    // Un archivo nuevo invalida la revisión anterior: enseñar los errores del
    // anterior junto al nombre del nuevo es la forma más directa de que alguien
    // aplique lo que no revisó.
    setArchivo(e.target.files?.[0] ?? null);
    setRevision(null);
    setAplicado(null);
    setError(null);
  }

  function previsualizar() {
    if (archivo === null) {
      setError("Elige el Excel del maestro");
      entradaRef.current?.focus();
      return;
    }

    setError(null);
    const formulario = new FormData();
    formulario.set("tenantId", tenantId);
    formulario.set("archivo", archivo);

    arrancar(async () => {
      const r = await validarImportacion(formulario);
      if (r.ok) {
        setRevision({
          importacionId: r.importacionId,
          errores: r.errores,
          erroresOmitidos: r.erroresOmitidos,
          resumen: r.resumen,
        });
      } else {
        setError(r.error);
      }
    });
  }

  function aplicar() {
    if (archivo === null || revision === null) return;

    setError(null);
    const formulario = new FormData();
    formulario.set("importacionId", revision.importacionId);
    formulario.set("archivo", archivo);

    arrancar(async () => {
      const r = await aplicarImportacion(formulario);
      if (r.ok) {
        setAplicado(r.resumen);
        // Una importación aplicada no se reaplica —la base lo impide—, así que
        // se limpia el paso: lo que queda en pantalla es el resultado.
        setRevision(null);
        setArchivo(null);
        if (entradaRef.current !== null) entradaRef.current.value = "";
      } else {
        setError(r.error);
      }
    });
  }

  const tieneErrores = revision !== null && revision.errores.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
        <div>
          <h2 className="text-[13px] font-bold">2 · Sube el archivo lleno</h2>
          <p className="text-[11.5px] text-muted-foreground">
            Se importará sobre el maestro de{" "}
            <strong className="font-bold text-foreground">
              {tenantNombre}
            </strong>
            . Para cambiar de cliente-marca, usa el selector de la cabecera.
          </p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold">Excel del maestro</span>
          <input
            ref={entradaRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={elegir}
            className="min-h-11 rounded-lg border border-border bg-background p-2 text-[13px] file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-[12px] file:font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </label>

        <button
          type="button"
          onClick={previsualizar}
          disabled={pendiente}
          className="min-h-11 self-start rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {pendiente ? "Revisando…" : "Previsualizar"}
        </button>

        {/* La región se monta siempre y solo cambia su texto: un `role="alert"`
            que aparece al fallar se lo pierden algunos lectores de pantalla. */}
        <p role="alert" className="text-[12px] text-alerta-texto empty:hidden">
          {error ?? ""}
        </p>
      </section>

      {revision !== null && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-[13px] font-bold">
              3 · Revisa antes de aplicar
            </h2>
            <p className="text-[11.5px] text-muted-foreground">
              Nada se ha escrito todavía en el maestro.
            </p>
          </div>

          <ResumenFilas titulo="Filas leídas" filas={revision.resumen} />

          {tieneErrores ? (
            <>
              <p className="text-[12px] font-semibold text-alerta-texto">
                {revision.errores.length} fila
                {revision.errores.length === 1 ? "" : "s"} con problemas. No se
                puede aplicar hasta corregirlas: la importación es todo o nada.
              </p>
              <TablaErrores
                errores={revision.errores}
                omitidos={revision.erroresOmitidos}
              />
            </>
          ) : (
            <p className="text-[12px] text-muted-foreground">
              Sin errores. Al aplicar, lo que ya existía se actualiza y lo nuevo
              se crea; nada se borra ni se desactiva por no venir en el archivo.
            </p>
          )}

          <button
            type="button"
            onClick={aplicar}
            disabled={pendiente || tieneErrores}
            className="min-h-11 self-start rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {pendiente ? "Aplicando…" : `Aplicar a ${tenantNombre}`}
          </button>
        </section>
      )}

      {aplicado !== null && (
        <section className="flex flex-col gap-3" aria-live="polite">
          <h2 className="text-[13px] font-bold">Maestro aplicado</h2>
          <ResumenFilas titulo="Filas escritas" filas={aplicado} />
        </section>
      )}
    </div>
  );
}

/** El recuento por entidad, igual en la previsualización y en el resultado. */
function ResumenFilas({
  titulo,
  filas,
}: {
  titulo: string;
  filas: Record<string, number>;
}) {
  const entradas = Object.entries(filas);

  if (entradas.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground">
        {titulo}: ninguna. El archivo no traía ninguna hoja con datos.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-[12px] font-semibold">{titulo}</h3>
      <ul className="flex flex-wrap gap-2">
        {entradas.map(([hoja, n]) => (
          <li
            key={hoja}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-[12px]"
          >
            <span className="text-muted-foreground">{hoja}</span>{" "}
            <span className="font-bold tabular-nums">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
