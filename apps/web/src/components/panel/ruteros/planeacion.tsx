"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Aviso } from "@/components/panel/tabla";
import { duplicarPeriodo } from "@/lib/panel/acciones-ruteros";
import {
  desplazamientoDeDuplicado,
  periodoVecino,
  rangoDeVista,
  type DiaPlaneado,
  type Vista,
} from "@/lib/panel/ruteros";
import { cn } from "@/lib/utils";

import { DiaRutero, type Tienda } from "./dia-rutero";

// El calendario de planeación. La semana y el mes son la MISMA lista de días con
// distinta densidad: `rutero` es por día y no hay entidad de periodo, así que
// cambiar de vista es cambiar el rango, no cambiar de modelo.
//
// El estado de la vista vive en la URL (`?vista=&dia=&mercaderista=`) para que la
// pantalla se pueda compartir y sobreviva a una recarga.

const MES_LARGO = new Intl.DateTimeFormat("es-PE", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export type Mercaderista = { id: string; nombre: string };

export function Planeacion({
  vista,
  dia,
  mercaderistaId,
  mercaderistas,
  tiendas,
  dias,
  hoyLima,
}: {
  vista: Vista;
  dia: string;
  mercaderistaId: string | null;
  mercaderistas: Mercaderista[];
  tiendas: Tienda[];
  dias: DiaPlaneado[];
  /** El día de hoy en Lima, resuelto en el servidor. */
  hoyLima: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  const [navegando, navegar] = useTransition();
  const router = useRouter();
  const { desde, hasta } = rangoDeVista(vista, dia);

  function url(cambios: Record<string, string>) {
    const p = new URLSearchParams({ vista, dia, ...cambios });
    if (mercaderistaId) p.set("mercaderista", mercaderistaId);
    if (cambios.mercaderista) p.set("mercaderista", cambios.mercaderista);
    return `/supervisor/ruteros?${p.toString()}`;
  }

  if (mercaderistas.length === 0) {
    return <Aviso>No hay mercaderistas activos que planificar.</Aviso>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5">
          <span className="text-[11.5px] font-semibold">Mercaderista</span>
          <select
            value={mercaderistaId ?? ""}
            // `replace` y no `push`: un `<select>` cerrado emite `change` en CADA
            // flecha del teclado, así que recorrer la lista con `push` dejaría un
            // rastro de entradas intermedias y el botón "atrás" tendría que
            // deshacerlas una a una. Cambiar de mercaderista es cambiar el filtro
            // de lo que se mira, no navegar a otro sitio.
            //
            // Tampoco se deshabilita mientras navega: deshabilitar el elemento
            // enfocado le quita el foco al usuario a mitad de la selección.
            onChange={(e) => {
              const destino = url({ mercaderista: e.target.value });
              navegar(() => router.replace(destino));
            }}
            className="min-h-11 rounded-lg border border-border bg-background px-2 text-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {mercaderistas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </label>
        {/* La navegación programática no pinta nada hasta que el destino commit-ea:
            sin esto, cambiar de mercaderista parece un clic ignorado. */}
        <span
          aria-live="polite"
          className="text-[11.5px] text-muted-foreground empty:hidden"
        >
          {navegando ? "Cargando…" : ""}
        </span>

        {/* La vista y el periodo son navegación: enlaces, no botones, para que
            la URL siempre describa lo que se está viendo. */}
        <nav aria-label="Vista" className="flex gap-1">
          {(["semana", "mes"] as const).map((v) => (
            <Link
              key={v}
              href={url({ vista: v })}
              aria-current={vista === v ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-[12px] font-semibold capitalize focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                vista === v ? "bg-accent" : "hover:bg-accent",
              )}
            >
              {v}
            </Link>
          ))}
        </nav>

        <nav aria-label="Periodo" className="flex items-center gap-1">
          <Link
            href={url({ dia: periodoVecino(vista, dia, -1) })}
            aria-label={`${vista === "semana" ? "Semana" : "Mes"} anterior`}
            className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-[12px] hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span aria-hidden="true">←</span>
          </Link>
          <span className="px-1 text-[12px] font-semibold capitalize">
            {vista === "mes"
              ? MES_LARGO.format(new Date(`${desde}T12:00:00Z`))
              : `${desde} → ${hasta}`}
          </span>
          <Link
            href={url({ dia: periodoVecino(vista, dia, 1) })}
            aria-label={`${vista === "semana" ? "Semana" : "Mes"} siguiente`}
            className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-[12px] hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span aria-hidden="true">→</span>
          </Link>
        </nav>

        <button
          type="button"
          disabled={pendiente || !mercaderistaId}
          onClick={() => {
            setError(null);
            iniciar(async () => {
              const r = await duplicarPeriodo({
                mercaderistaId,
                desde,
                hasta,
                dias: desplazamientoDeDuplicado(vista, dia),
              });
              if (!r.ok) setError(r.error);
            });
          }}
          className="ml-auto min-h-11 rounded-lg border border-border px-3 text-[12px] font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
        >
          {pendiente ? "Copiando…" : `Copiar ${vista} al siguiente`}
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-[12px] text-alerta-texto">
          {error}
        </p>
      ) : null}

      <p className="text-[11.5px] text-muted-foreground">
        Copiar duplica el periodo sobre el siguiente como{" "}
        <strong>borrador</strong>, sin tocar los días que ya tengan rutero. Un
        rutero solo llega al teléfono del mercaderista cuando se{" "}
        <strong>publica</strong>.
      </p>

      {mercaderistaId ? (
        <div
          className={cn(
            "grid gap-2",
            vista === "semana"
              ? "grid-cols-1 md:grid-cols-4 xl:grid-cols-7"
              : "grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7",
          )}
        >
          {dias.map((d) => (
            <DiaRutero
              key={d.fecha}
              dia={d}
              mercaderistaId={mercaderistaId}
              tiendas={tiendas}
              hoyLima={hoyLima}
              compacto={vista === "mes"}
            />
          ))}
        </div>
      ) : (
        <Aviso>Elige un mercaderista para ver su planeación.</Aviso>
      )}
    </div>
  );
}
