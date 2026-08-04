"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { topicoStaff } from "@market-track/shared";

import { Aviso } from "@/components/panel/tabla";
import {
  aplicarResolucion,
  pendientes,
  type Solicitud,
} from "@/lib/panel/solicitudes";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { FilaSolicitud } from "./fila-solicitud";

// La bandeja del supervisor. Carga en servidor y encima aplica el canal privado
// `staff:solicitud_cambio_ruta` (MAR-61).
//
// El broadcast trae la fila cruda de `solicitud_cambio_ruta`, sin el nombre del
// mercaderista — que es lo primero que el supervisor necesita leer. Por eso una
// solicitud nueva pide recarga al servidor en vez de pintarse a medias. Una
// resolución sí se aplica en el sitio: la hizo él y ya conoce todos los datos.

export function BandejaSolicitudes({
  solicitudesIniciales,
  soloMiEquipo,
}: {
  solicitudesIniciales: Solicitud[];
  soloMiEquipo: boolean;
}) {
  const [solicitudes, setSolicitudes] = useState(solicitudesIniciales);
  const router = useRouter();
  const recargaPendiente = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setSolicitudes(solicitudesIniciales), [solicitudesIniciales]);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let vivo = true;

    function pedirRecarga() {
      if (recargaPendiente.current) clearTimeout(recargaPendiente.current);
      recargaPendiente.current = setTimeout(() => router.refresh(), 400);
    }

    async function suscribir() {
      // Sin `setAuth()` Realtime no evalúa la RLS y rechaza el canal privado.
      await supabase.realtime.setAuth();
      if (!vivo) return;

      const canal = supabase
        .channel(topicoStaff("solicitud_cambio_ruta"), {
          config: { private: true },
        })
        .on("broadcast", { event: "INSERT" }, pedirRecarga)
        .subscribe();

      return () => {
        void supabase.removeChannel(canal);
      };
    }

    const limpieza = suscribir();
    return () => {
      vivo = false;
      if (recargaPendiente.current) clearTimeout(recargaPendiente.current);
      void limpieza.then((fn) => fn?.());
    };
    // El topic es fijo: se suscribe una vez.
  }, [router]);

  const sinResolver = pendientes(solicitudes);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span
          aria-live="polite"
          className={cn(
            "inline-flex rounded-full px-2.5 py-0.5 text-[11.5px] font-bold",
            sinResolver > 0
              ? "bg-alerta-suave text-alerta-texto"
              : "bg-muted text-muted-foreground",
          )}
        >
          {sinResolver === 0
            ? "Ninguna pendiente"
            : `${sinResolver} sin resolver`}
        </span>
        {/* Un enlace, no un botón: el filtro vive en la URL, así que la vista se
            comparte y sobrevive a una recarga. */}
        <a
          href={soloMiEquipo ? "?equipo=todas" : "?equipo=mias"}
          className="rounded-lg border border-border px-3 py-1.5 text-[12px] font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {soloMiEquipo ? "Ver todas" : "Ver solo mi equipo"}
        </a>
      </div>

      {solicitudes.length === 0 ? (
        <Aviso>
          {soloMiEquipo
            ? "Tu equipo no tiene solicitudes de cambio de ruta."
            : "No hay solicitudes de cambio de ruta."}
        </Aviso>
      ) : (
        <ul className="flex flex-col gap-3">
          {solicitudes.map((s) => (
            <FilaSolicitud
              key={s.id}
              solicitud={s}
              onResuelta={(resolucion) =>
                setSolicitudes((actuales) =>
                  aplicarResolucion(actuales, resolucion),
                )
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
