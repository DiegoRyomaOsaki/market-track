import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { detalleVisitaSchema } from "@market-track/shared";

import { DecisionRevision } from "@/components/panel/revision/decision-revision";
import {
  ETIQUETA_FOTO,
  FotoEvidencia,
} from "@/components/evidencia/foto-evidencia";
import { Aviso, Pastilla, TD, TH } from "@/components/panel/tabla";
import { urlsFirmadas } from "@/lib/fotos-firmadas";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Detalle del reporte — Market Track",
};

// Las URLs firmadas caducan en minutos: cachear esta página serviría enlaces
// muertos, y guardaría evidencia privada en una caché compartida.
export const dynamic = "force-dynamic";

const FECHA = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Lima",
});

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{etiqueta}</dt>
      <dd className="text-[12.5px] font-semibold">{valor}</dd>
    </div>
  );
}

function siNo(v: boolean | null): string {
  if (v === null) return "—";
  return v ? "Sí" : "No";
}

export default async function DetalleReportePage({
  params,
}: {
  params: Promise<{ visitaId: string }>;
}) {
  const { visitaId } = await params;

  // Un route param es entrada externa. Sin esta guarda, cualquier basura en la URL
  // llega hasta Postgres y vuelve como un error de cast que se pinta como "no
  // pudimos cargar el reporte" — cuando lo honesto es un 404.
  if (!z.guid().safeParse(visitaId).success) notFound();

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("detalle_visita", {
    p_visita_id: visitaId,
  });

  if (error) {
    console.error("[revision] carga del detalle", error.message.slice(0, 200));
    return <Aviso>No pudimos cargar el reporte. Vuelve a intentarlo.</Aviso>;
  }
  // La función devuelve null tanto si la visita no existe como si el que llama no
  // la ve: no se distingue a propósito.
  if (data === null) notFound();

  const parsed = detalleVisitaSchema.safeParse(data);
  if (!parsed.success) {
    console.error(
      "[revision] detalle con forma inesperada",
      parsed.error.message.slice(0, 200),
    );
    return <Aviso>El reporte llegó con un formato que no reconocemos.</Aviso>;
  }
  const detalle = parsed.data;

  // Solo se firma lo que ya está en R2: mientras el binario siga en el teléfono no
  // hay objeto que firmar.
  const subidas = detalle.fotos.filter((f) => f.subida_at !== null);
  const { urls, degradado } = await urlsFirmadas(
    supabase,
    subidas.map((f) => f.id),
  );
  const pendientesDeSubida = detalle.fotos.length - subidas.length;

  const fotosDeVisita = detalle.fotos.filter(
    (f) => f.levantamiento_id === null,
  );

  return (
    <div className="flex flex-col gap-4">
      {degradado ? (
        <Aviso>
          No pudimos preparar los enlaces de algunas fotos. Es un problema
          nuestro, no del teléfono del mercaderista: vuelve a intentarlo.
        </Aviso>
      ) : null}

      <Link
        href="/supervisor/revision"
        className="text-[12px] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        ← Volver a la cola
      </Link>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
        <h2 className="text-[13px] font-bold">
          {detalle.visita.tienda_nombre}{" "}
          <span className="font-normal text-muted-foreground">
            · {detalle.visita.cadena_nombre}
          </span>
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Dato
            etiqueta="Mercaderista"
            valor={detalle.visita.mercaderista_nombre}
          />
          <Dato
            etiqueta="Check-in"
            valor={FECHA.format(new Date(detalle.visita.check_in_at))}
          />
          <Dato
            etiqueta="Check-out"
            valor={
              detalle.visita.check_out_at
                ? FECHA.format(new Date(detalle.visita.check_out_at))
                : "—"
            }
          />
          <Dato
            etiqueta="Duración"
            valor={
              detalle.visita.duracion_min === null
                ? "—"
                : `${detalle.visita.duracion_min} min`
            }
          />
          <Dato
            etiqueta="Geocerca entrada"
            valor={siNo(detalle.visita.check_in_geocerca_ok)}
          />
          <Dato
            etiqueta="Geocerca salida"
            valor={siNo(detalle.visita.check_out_geocerca_ok)}
          />
          <Dato
            etiqueta="Traslado"
            valor={
              detalle.visita.tiempo_traslado_min === null
                ? "—"
                : `${detalle.visita.tiempo_traslado_min} min`
            }
          />
          <Dato
            etiqueta="Batería al iniciar"
            valor={
              detalle.visita.bateria_inicio_pct === null
                ? "—"
                : `${detalle.visita.bateria_inicio_pct}%`
            }
          />
        </dl>
        {detalle.visita.bitacora ? (
          <div>
            <h3 className="text-[11px] text-muted-foreground">Bitácora</h3>
            <p className="whitespace-pre-wrap text-[12.5px]">
              {detalle.visita.bitacora}
            </p>
          </div>
        ) : null}
      </section>

      <DecisionRevision
        visitaId={detalle.visita.id}
        evidenciaPendiente={pendientesDeSubida}
        revisionInicial={
          detalle.revision
            ? {
                decision: detalle.revision.decision,
                motivo: detalle.revision.motivo,
                revisorNombre: detalle.revision.revisor_nombre,
                revisadoAt: detalle.revision.revisado_at,
              }
            : null
        }
      />

      {detalle.contingencias.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-background p-4">
          <h2 className="text-[13px] font-bold">
            Contingencias ({detalle.contingencias.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {detalle.contingencias.map((c, i) => (
              <li key={i} className="rounded-lg bg-muted px-3 py-2">
                <p className="text-[12.5px]">
                  <Pastilla tono="bg-alerta-suave text-alerta-texto">
                    {c.paso}
                  </Pastilla>{" "}
                  {c.motivo}
                </p>
                {c.comentario ? (
                  <p className="text-[11.5px] text-muted-foreground">
                    {c.comentario}
                  </p>
                ) : null}
                <p className="text-[11px] text-muted-foreground">
                  {FECHA.format(new Date(c.registrada_at))}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {fotosDeVisita.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-background p-4">
          <h2 className="text-[13px] font-bold">Evidencia de la visita</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {fotosDeVisita.map((f) => (
              <FotoEvidencia
                key={f.id}
                url={urls[f.id]}
                etiqueta={ETIQUETA_FOTO[f.tipo]}
                capturadaAt={f.capturada_at}
              />
            ))}
          </div>
        </section>
      ) : null}

      {detalle.levantamientos.map((lev) => {
        const fotos = detalle.fotos.filter(
          (f) => f.levantamiento_id === lev.id,
        );
        return (
          <section
            key={lev.id}
            className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[13px] font-bold">{lev.marca_nombre}</h2>
              <Pastilla
                tono={
                  lev.estado === "omitido"
                    ? "bg-alerta-suave text-alerta-texto"
                    : "bg-completado-suave text-completado-texto"
                }
              >
                {lev.estado}
              </Pastilla>
            </div>

            {lev.sos_frentes_propios !== null ? (
              <p className="text-[12px] text-muted-foreground">
                Share of Shelf: {lev.sos_frentes_propios} frentes propios.
              </p>
            ) : null}

            {fotos.length > 0 ? (
              // Antes y Después uno al lado del otro: comparar es la razón de
              // pedir las dos.
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {fotos.map((f) => (
                  <FotoEvidencia
                    key={f.id}
                    url={urls[f.id]}
                    etiqueta={ETIQUETA_FOTO[f.tipo]}
                    capturadaAt={f.capturada_at}
                  />
                ))}
              </div>
            ) : null}

            {lev.skus.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[40rem] border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-border bg-muted">
                      <th className={TH}>SKU</th>
                      <th className={TH}>Sistema</th>
                      <th className={TH}>Piso</th>
                      <th className={TH}>Hallazgo</th>
                      <th className={TH}>Precio</th>
                      <th className={TH}>Promo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lev.skus.map((s) => (
                      <tr
                        key={s.codigo}
                        className="border-b border-border last:border-0"
                      >
                        <td className={TD}>
                          <span className="block">{s.nombre}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {s.codigo}
                          </span>
                        </td>
                        <td className={TD}>{s.stock_sistema ?? "—"}</td>
                        <td className={TD}>{s.stock_piso ?? "—"}</td>
                        <td className={TD}>
                          {s.quiebre ? (
                            <Pastilla tono="bg-alerta-suave text-alerta-texto">
                              Quiebre
                            </Pastilla>
                          ) : s.diferencia ? (
                            <Pastilla tono="bg-en-curso-suave text-en-curso-texto">
                              Diferencia
                            </Pastilla>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className={TD}>
                          {s.precio_registrado === null
                            ? "—"
                            : `S/ ${s.precio_registrado.toFixed(2)}`}
                        </td>
                        <td className={TD}>
                          {s.hay_promo === null
                            ? "—"
                            : s.hay_promo
                              ? `Sí · ${s.promo_comunicada ? "comunicada" : "sin comunicar"}`
                              : "No"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {lev.exhibiciones.length > 0 ? (
              <ul className="flex flex-col gap-1 text-[12px]">
                {lev.exhibiciones.map((e, i) => (
                  <li key={i} className="rounded-lg bg-muted px-3 py-1.5">
                    {e.tipo ?? "Exhibición"}{" "}
                    <span className="text-muted-foreground">
                      · {e.negociada ? "negociada" : "adicional"} · instalada:{" "}
                      {siNo(e.instalada)} · completa: {siNo(e.completa)} ·
                      vigente: {siNo(e.vigente)}
                      {e.unidades === null ? "" : ` · ${e.unidades} u.`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
