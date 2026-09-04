"use client";

import Link from "next/link";

// Las piezas que comparten los formularios del panel (cliente, marca, cadena,
// tienda): mismo campo, mismo error, mismo pie.

export const campo =
  "h-[38px] w-full rounded-[9px] border border-border bg-background px-3 text-[13px]";
export const etiqueta = "text-[12.5px] font-semibold";

/** El error del servidor, anunciado a los lectores de pantalla al aparecer. */
export function Errores({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="rounded-[9px] bg-alerta-suave px-3 py-2 text-[13px] font-semibold text-alerta-texto"
    >
      {error}
    </p>
  );
}

export function Pie({
  enviando,
  editando,
  volverA = "/admin",
}: {
  enviando: boolean;
  editando: boolean;
  volverA?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="submit"
        disabled={enviando}
        className="flex h-[38px] items-center rounded-[9px] bg-primary px-4 text-[13px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {enviando ? "Guardando…" : editando ? "Guardar cambios" : "Crear"}
      </button>
      <Link
        href={volverA}
        className="text-[13px] font-semibold text-muted-foreground hover:underline"
      >
        Cancelar
      </Link>
    </div>
  );
}
