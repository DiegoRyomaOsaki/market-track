"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { topicoStaff } from "@market-track/shared";

import { Aviso, Pastilla, TD, TH } from "@/components/panel/tabla";
import {
  estiloDecision,
  etiquetaDecision,
  faltaEvidencia,
  pendientes,
  type VisitaEnCola,
} from "@/lib/panel/revision";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

// La cola de reportes por revisar. Carga en servidor y encima escucha el canal
// privado `staff:visita` que ya existe: una visita pasa a `completada` con un
// UPDATE, que es exactamente el evento que hace crecer esta cola. No hace falta
// un feed nuevo.
//
// El broadcast trae la fila cruda de `visita`, sin el nombre del mercaderista ni
// los conteos derivados, así que se pide recarga al servidor en vez de pintar una
// fila a medias.

const HORA_CORTA = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Lima",
});

export function ColaRevision({
  visitasIniciales,
  soloPendientes,
}: {
  visitasIniciales: VisitaEnCola[];
  soloPendientes: boolean;
}) {
  const [visitas, setVisitas] = useState(visitasIniciales);
  const router = useRouter();
  const recargaPendiente = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setVisitas(visitasIniciales), [visitasIniciales]);

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
        .channel(topicoStaff("visita"), { config: { private: true } })
        .on("broadcast", { event: "UPDATE" }, pedirRecarga)
        .subscribe();

      return canal;
    }

    const pendiente = suscribir();

    return () => {
      vivo = false;
      if (recargaPendiente.current) clearTimeout(recargaPendiente.current);
      void pendiente.then((c) => c && supabase.removeChannel(c));
    };
  }, [router]);

  const visibles = soloPendientes
    ? visitas.filter((v) => v.decision === null)
    : visitas;
  const porRevisar = pendientes(visitas);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Filtro" className="flex gap-1">
          {[
            { pendientes: true, label: "Por revisar" },
            { pendientes: false, label: "Todas" },
          ].map((o) => (
            <Link
              key={o.label}
              href={
                o.pendientes
                  ? "/supervisor/revision"
                  : "/supervisor/revision?ver=todas"
              }
              aria-current={
                soloPendientes === o.pendientes ? "page" : undefined
              }
              className={
                "inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-[12px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
                (soloPendientes === o.pendientes
                  ? "bg-accent"
                  : "hover:bg-accent")
              }
            >
              {o.label}
            </Link>
          ))}
        </nav>
        <p className="text-[11.5px] text-muted-foreground">
          {porRevisar === 0
            ? "Nada pendiente de revisión."
            : `${porRevisar} ${porRevisar === 1 ? "reporte espera" : "reportes esperan"} decisión.`}
        </p>
      </div>

      {visibles.length === 0 ? (
        <Aviso>
          {soloPendientes
            ? "No hay reportes por revisar en este periodo."
            : "No hay visitas cerradas en este periodo."}
        </Aviso>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[52rem] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-border bg-muted">
                <th className={TH}>Mercaderista</th>
                <th className={TH}>Tienda</th>
                <th className={TH}>Cierre</th>
                <th className={TH}>Duración</th>
                <th className={TH}>Hallazgos</th>
                <th className={TH}>Evidencia</th>
                <th className={TH}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((v) => (
                <tr
                  key={v.visita_id}
                  className="border-b border-border last:border-0"
                >
                  <td className={TD}>
                    <Link
                      href={`/supervisor/revision/${v.visita_id}`}
                      className="font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {v.mercaderista_nombre}
                    </Link>
                  </td>
                  <td className={TD}>
                    <span className="block">{v.tienda_nombre}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {v.cadena_nombre}
                    </span>
                  </td>
                  <td className={TD}>
                    {v.check_out_at
                      ? HORA_CORTA.format(new Date(v.check_out_at))
                      : "—"}
                  </td>
                  <td className={TD}>
                    {v.duracion_min === null ? "—" : `${v.duracion_min} min`}
                  </td>
                  <td className={TD}>
                    <span className="text-muted-foreground">
                      {v.marcas} {v.marcas === 1 ? "marca" : "marcas"}
                      {v.omitidos > 0 ? ` · ${v.omitidos} omitida(s)` : ""}
                      {v.quiebres > 0 ? ` · ${v.quiebres} quiebre(s)` : ""}
                      {v.contingencias > 0
                        ? ` · ${v.contingencias} contingencia(s)`
                        : ""}
                    </span>
                  </td>
                  <td className={TD}>
                    {faltaEvidencia(v) ? (
                      <Pastilla tono="bg-en-curso-suave text-en-curso-texto">
                        {`${v.fotos_pendientes} sin subir`}
                      </Pastilla>
                    ) : (
                      <span className="text-muted-foreground">
                        {v.fotos} {v.fotos === 1 ? "foto" : "fotos"}
                      </span>
                    )}
                  </td>
                  <td className={TD}>
                    <Pastilla tono={estiloDecision(v.decision)}>
                      {etiquetaDecision(v.decision)}
                    </Pastilla>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
