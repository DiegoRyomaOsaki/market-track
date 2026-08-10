import type { Metadata } from "next";
import Link from "next/link";

import {
  Avatar,
  Aviso,
  Estado,
  Tarjeta,
  TD,
  TH,
} from "@/components/panel/tabla";
import {
  esTab,
  PestanasUsuarios,
  type TabUsuarios,
} from "@/components/usuarios/pestanas";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Usuarios — Market Track" };

function primero(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function UsuariosPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string | string[];
    q?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const tabParam = primero(params.tab);
  const tab: TabUsuarios = esTab(tabParam) ? tabParam : "mercaderistas";
  const busqueda = (primero(params.q) ?? "").trim();

  const supabase = await createServerSupabaseClient();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <PestanasUsuarios activa={tab} />
        <div className="flex-1" />
        <form className="relative" action="/admin/usuarios">
          <input type="hidden" name="tab" value={tab} />
          <input
            name="q"
            defaultValue={busqueda}
            placeholder="Buscar…"
            aria-label="Buscar por nombre"
            className="h-[38px] w-[240px] rounded-[9px] border border-border bg-background px-3 text-[13px]"
          />
        </form>
        <Link
          href="/admin/usuarios/nuevo"
          className="flex h-[38px] items-center rounded-[9px] bg-primary px-4 text-[13px] font-semibold text-primary-foreground hover:opacity-90"
        >
          + Nuevo usuario
        </Link>
      </div>

      <TablaPersonas supabase={supabase} tab={tab} busqueda={busqueda} />
    </div>
  );
}

type Supabase = Awaited<ReturnType<typeof createServerSupabaseClient>>;

async function TablaPersonas({
  supabase,
  tab,
  busqueda,
}: {
  supabase: Supabase;
  tab: TabUsuarios;
  busqueda: string;
}) {
  const rol =
    tab === "mercaderistas"
      ? "mercaderista"
      : tab === "supervisores"
        ? "supervisor"
        : "cliente";

  let query = supabase
    .from("profile")
    .select(
      "id, nombre, dni, telefono, activo, sctr_vigente_hasta, supervisor:supervisor_id(nombre), tenant:tenant_id(nombre)",
    )
    .eq("rol", rol)
    .order("nombre");
  if (busqueda) query = query.ilike("nombre", `%${busqueda}%`);

  const { data, error } = await query;
  if (error) return <Aviso>No se pudieron cargar los usuarios.</Aviso>;
  const filas = data ?? [];
  if (filas.length === 0) {
    return (
      <Aviso>
        {busqueda ? "Sin resultados para la búsqueda." : "Aún no hay usuarios."}
      </Aviso>
    );
  }

  const esMerc = tab === "mercaderistas";
  const esCliente = tab === "clientes";

  return (
    <Tarjeta>
      <thead>
        <tr className="border-b border-border bg-muted/40">
          <th scope="col" className={TH}>
            {esMerc ? "MERCADERISTA" : esCliente ? "CLIENTE" : "SUPERVISOR"}
          </th>
          <th scope="col" className={TH}>
            DNI
          </th>
          <th scope="col" className={TH}>
            TELÉFONO
          </th>
          {esMerc && (
            <th scope="col" className={TH}>
              SUPERVISOR
            </th>
          )}
          {esMerc && (
            <th scope="col" className={TH}>
              SCTR
            </th>
          )}
          {esCliente && (
            <th scope="col" className={TH}>
              CLIENTE-MARCA
            </th>
          )}
          <th scope="col" className={TH}>
            ESTADO
          </th>
          {esMerc && (
            <th scope="col" className={TH}>
              <span className="sr-only">Acceso</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {filas.map((f) => (
          <tr key={f.id} className="border-b border-border last:border-0">
            <td className={TD}>
              <div className="flex items-center gap-2.5">
                <Avatar nombre={f.nombre} />
                <span className="font-semibold">{f.nombre}</span>
              </div>
            </td>
            <td className={`${TD} font-mono`}>{f.dni ?? "—"}</td>
            <td className={`${TD} font-mono`}>{f.telefono ?? "—"}</td>
            {esMerc && (
              <td className={`${TD} text-muted-foreground`}>
                {f.supervisor?.nombre ?? "—"}
              </td>
            )}
            {esMerc && (
              <td className={`${TD} font-mono`}>
                {f.sctr_vigente_hasta ?? "—"}
              </td>
            )}
            {esCliente && <td className={TD}>{f.tenant?.nombre ?? "—"}</td>}
            <td className={TD}>
              <Estado activo={f.activo} />
            </td>
            {/* La entrada al pase de acceso desde la persona, que es donde surge
                la necesidad: el mercaderista llama porque no le llega el código. */}
            {esMerc && (
              <td className={TD}>
                <Link
                  href="/admin/acceso"
                  className="text-[12px] font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  Acceso
                </Link>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </Tarjeta>
  );
}
