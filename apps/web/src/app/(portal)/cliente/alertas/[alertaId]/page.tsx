import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { detalleAlertaSchema } from "@market-track/shared";

import { FotoEvidencia } from "@/components/evidencia/foto-evidencia";
import { Aviso, Pastilla } from "@/components/panel/tabla";
import { EstadoDeAlerta } from "@/components/portal/alertas/estado-alerta";
import { urlsFirmadas } from "@/lib/fotos-firmadas";
import {
  ESTILO_ESTADO,
  ESTILO_SEVERIDAD,
  ETIQUETA_ESTADO,
  ETIQUETA_SEVERIDAD,
  ETIQUETA_TIPO_ALERTA,
  filaDeVigencia,
  filasDeEvidencia,
  rotuloDeFoto,
} from "@/lib/portal/alertas";
import { requerirModulo } from "@/lib/portal/estado-modulos";
import type { ParamsBusqueda } from "@/lib/portal/filtros";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Alerta — Market Track" };

// Las URLs firmadas caducan en minutos y el estado cambia mientras se trabaja:
// nada de esto se puede servir cacheado.
export const dynamic = "force-dynamic";

const FECHA = new Intl.DateTimeFormat("es-PE", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Lima",
});

export default async function DetalleAlertaPage({
  params,
  searchParams,
}: {
  params: Promise<{ alertaId: string }>;
  searchParams: Promise<ParamsBusqueda>;
}) {
  await requerirModulo("alertas");

  const { alertaId } = await params;
  // La URL la escribe cualquiera: se valida la forma antes de tocar Postgres, o
  // un id con basura muere en un error de cast disfrazado de fallo del servidor.
  if (!z.guid().safeParse(alertaId).success) notFound();

  const busqueda = new URLSearchParams();
  for (const [clave, valor] of Object.entries(await searchParams)) {
    const v = Array.isArray(valor) ? valor[0] : valor;
    if (v !== undefined) busqueda.set(clave, v);
  }
  const volver = `/cliente/alertas${busqueda.toString() ? `?${busqueda}` : ""}`;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("detalle_alerta", {
    p_alerta_id: alertaId,
  });

  if (error) {
    console.error("[alertas] detalle", error.message.slice(0, 200));
    return <Aviso>No pudimos cargar la alerta. Vuelve a intentarlo.</Aviso>;
  }
  // Null tanto si no existe como si es de otro cliente: indistinguibles a
  // propósito, para no confirmar la existencia de una alerta ajena.
  if (data === null) notFound();

  const parsed = detalleAlertaSchema.safeParse(data);
  if (!parsed.success) {
    console.error(
      "[alertas] forma inesperada",
      parsed.error.message.slice(0, 200),
    );
    return <Aviso>La alerta llegó con un formato que no reconocemos.</Aviso>;
  }
  const alerta = parsed.data;

  // Solo se firma lo que ya está en R2: mientras el binario siga en el teléfono
  // no hay objeto que firmar.
  const firmables =
    alerta.foto !== null && alerta.foto.subida_at !== null
      ? [alerta.foto.id]
      : [];
  const { urls, degradado } = await urlsFirmadas(supabase, firmables);

  // La ventana del precio se pinta como una evidencia más, al final: es parte de
  // por qué la alerta dice lo que dice.
  const vigencia = filaDeVigencia(
    alerta.precio_vigente_desde,
    alerta.precio_vigente_hasta,
  );
  const evidencia = [
    ...filasDeEvidencia(alerta.tipo, alerta.payload),
    ...(vigencia === null ? [] : [vigencia]),
  ];

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={volver}
        className="text-[12px] text-muted-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        ← Volver a las alertas
      </Link>

      <header className="flex flex-col gap-2 rounded-xl border border-border bg-background p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[15px] font-bold">
            {ETIQUETA_TIPO_ALERTA[alerta.tipo]}
          </h1>
          <Pastilla tono={ESTILO_SEVERIDAD[alerta.severidad]}>
            {ETIQUETA_SEVERIDAD[alerta.severidad]}
          </Pastilla>
          <Pastilla tono={ESTILO_ESTADO[alerta.estado]}>
            {ETIQUETA_ESTADO[alerta.estado]}
          </Pastilla>
        </div>
        <p className="text-[12px] text-muted-foreground">
          {alerta.sku_nombre ?? "Sin producto asociado"}
          {alerta.marca_nombre === null ? "" : ` · ${alerta.marca_nombre}`}
          {alerta.tienda_nombre === null ? "" : ` · ${alerta.tienda_nombre}`}
          {` · Detectada el ${FECHA.format(new Date(alerta.creado_at))}`}
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
        <h2 className="text-[13px] font-bold">Evidencia</h2>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {evidencia.map((f) => (
            <div key={f.etiqueta} className="flex flex-col">
              <dt className="text-[11.5px] text-muted-foreground">
                {f.etiqueta}
              </dt>
              <dd className="text-[13px] font-semibold">{f.valor}</dd>
            </div>
          ))}
        </dl>

        {degradado ? (
          <Aviso>
            No pudimos preparar el enlace de la foto. Es un problema nuestro, no
            del trabajo en tienda: vuelve a intentarlo.
          </Aviso>
        ) : null}

        {alerta.foto === null ? (
          <p className="text-[11.5px] text-muted-foreground">
            Esta alerta no tiene foto asociada. La evidencia es el dato.
          </p>
        ) : (
          <div className="max-w-sm">
            <FotoEvidencia
              url={urls[alerta.foto.id]}
              etiqueta={rotuloDeFoto(alerta)}
              capturadaAt={alerta.foto.capturada_at}
              aspecto="4/3"
            />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-border bg-background p-4">
        <h2 className="text-[13px] font-bold">Seguimiento</h2>
        <EstadoDeAlerta alertaId={alerta.id} estado={alerta.estado} />
        <p className="text-[11.5px] text-muted-foreground">
          Cambiar el estado no altera la evidencia: lo que se registró en tienda
          queda como está.
        </p>
      </section>
    </div>
  );
}
