import type { Metadata } from "next";
import Link from "next/link";

import {
  botonPrimario,
  buscador,
  enlaceTabla,
} from "@/components/panel/estilos";
import {
  Avatar,
  Aviso,
  Estado,
  Tarjeta,
  TD,
  TH,
} from "@/components/panel/tabla";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Formularios — Market Track" };

// El constructor de formularios de levantamiento (ADR-0010): un formulario por
// cliente (y marca opcional), con su definición versionada. Aquí se listan; el
// trabajo de diseño está en el detalle.

function primero(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

type Version = { version: number; publicada: boolean };

/** El estado a mostrar: la publicada vigente y si hay un borrador por encima. */
function estadoDeVersiones(versiones: Version[]): string {
  const publicadas = versiones.filter((v) => v.publicada).map((v) => v.version);
  const borradores = versiones
    .filter((v) => !v.publicada)
    .map((v) => v.version);
  const publicadaMax = publicadas.length ? Math.max(...publicadas) : null;
  const borradorMax = borradores.length ? Math.max(...borradores) : null;

  if (publicadaMax != null) {
    return borradorMax != null
      ? `Publicado v${publicadaMax} · borrador v${borradorMax}`
      : `Publicado v${publicadaMax}`;
  }
  if (borradorMax != null) return `Borrador v${borradorMax} (sin publicar)`;
  return "Sin versiones";
}

export default async function FormulariosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const busqueda = (primero(params.q) ?? "").trim();

  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from("formulario_levantamiento")
    .select(
      "id, nombre, activo, ambito, tenant:tenant_id(nombre), marca:marca_id(nombre), versiones:formulario_version(version, publicada)",
    )
    .order("creado_at", { ascending: false });
  if (busqueda) query = query.ilike("nombre", `%${busqueda}%`);

  const { data, error } = await query;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <form action="/admin/formularios">
          <input
            name="q"
            defaultValue={busqueda}
            placeholder="Buscar por nombre…"
            aria-label="Buscar formulario por nombre"
            className={buscador}
          />
        </form>
        <div className="flex-1" />
        <Link href="/admin/formularios/nuevo" className={botonPrimario}>
          + Nuevo formulario
        </Link>
      </div>

      {error ? (
        <Aviso>No se pudieron cargar los formularios.</Aviso>
      ) : (data?.length ?? 0) === 0 ? (
        <Aviso>
          {busqueda
            ? "Ningún formulario coincide con la búsqueda."
            : "Aún no hay formularios. Crea uno para configurar qué campos captura el mercaderista."}
        </Aviso>
      ) : (
        <Tarjeta>
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th scope="col" className={TH}>
                FORMULARIO
              </th>
              <th scope="col" className={TH}>
                CLIENTE
              </th>
              <th scope="col" className={TH}>
                MARCA
              </th>
              <th scope="col" className={TH}>
                ÁMBITO
              </th>
              <th scope="col" className={TH}>
                VERSIÓN
              </th>
              <th scope="col" className={TH}>
                ESTADO
              </th>
              <th scope="col" className={TH}>
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((f) => (
              <tr key={f.id} className="border-b border-border last:border-0">
                <td className={TD}>
                  <div className="flex items-center gap-2.5">
                    <Avatar nombre={f.nombre} />
                    <span className="font-semibold">{f.nombre}</span>
                  </div>
                </td>
                <td className={`${TD} text-muted-foreground`}>
                  {f.tenant?.nombre ?? "—"}
                </td>
                <td className={`${TD} text-muted-foreground`}>
                  {f.marca?.nombre ?? (f.ambito === "check_in" ? "—" : "Todas")}
                </td>
                <td className={`${TD} text-muted-foreground`}>
                  {f.ambito === "check_in" ? "Check-in" : "Levantamiento"}
                </td>
                <td className={`${TD} text-muted-foreground`}>
                  {estadoDeVersiones(f.versiones ?? [])}
                </td>
                <td className={TD}>
                  <Estado activo={f.activo} />
                </td>
                <td className={`${TD} text-right`}>
                  <Link
                    href={`/admin/formularios/${f.id}`}
                    className={enlaceTabla}
                  >
                    Editar
                    <span className="sr-only"> el formulario {f.nombre}</span>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </Tarjeta>
      )}
    </div>
  );
}
