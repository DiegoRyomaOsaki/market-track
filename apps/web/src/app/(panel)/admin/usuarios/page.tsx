import type { Metadata } from "next";
import Link from "next/link";

import { BajaCliente } from "@/components/usuarios/baja-cliente";
import {
  esTab,
  Pestanas,
  type TabUsuarios,
} from "@/components/usuarios/pestanas";
import { iniciales } from "@/lib/panel/iniciales";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Usuarios — Market Track" };

const TH =
  "text-left font-semibold text-muted-foreground px-4 py-2.5 text-[11.5px]";
const TD = "px-4 py-3 align-middle";

function primero(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function Avatar({ nombre }: { nombre: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-[30px] items-center justify-center rounded-full bg-accent text-[11.5px] font-bold text-accent-foreground"
    >
      {iniciales(nombre)}
    </span>
  );
}

function Tarjeta({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-background">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  );
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
        <Pestanas activa={tab} />
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

      {tab === "clientes-marca" ? (
        <TablaClientesMarca supabase={supabase} busqueda={busqueda} />
      ) : (
        <TablaPersonas supabase={supabase} tab={tab} busqueda={busqueda} />
      )}
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
  tab: Exclude<TabUsuarios, "clientes-marca">;
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
          </tr>
        ))}
      </tbody>
    </Tarjeta>
  );
}

async function TablaClientesMarca({
  supabase,
  busqueda,
}: {
  supabase: Supabase;
  busqueda: string;
}) {
  let query = supabase
    .from("tenant")
    .select("id, nombre, activo")
    .order("nombre");
  if (busqueda) query = query.ilike("nombre", `%${busqueda}%`);

  const [{ data: tenants, error }, { data: mercs, error: errMercs }] =
    await Promise.all([
      query,
      supabase
        .from("profile")
        .select("tenant_id")
        .eq("rol", "mercaderista")
        .eq("activo", true),
    ]);

  if (error || errMercs) {
    return <Aviso>No se pudieron cargar los clientes-marca.</Aviso>;
  }
  const filas = tenants ?? [];
  if (filas.length === 0) return <Aviso>No hay clientes-marca.</Aviso>;

  const activosPorTenant = new Map<string, number>();
  for (const m of mercs ?? []) {
    if (m.tenant_id) {
      activosPorTenant.set(
        m.tenant_id,
        (activosPorTenant.get(m.tenant_id) ?? 0) + 1,
      );
    }
  }

  return (
    <Tarjeta>
      <thead>
        <tr className="border-b border-border bg-muted/40">
          <th scope="col" className={TH}>
            CLIENTE-MARCA
          </th>
          <th scope="col" className={TH}>
            MERCADERISTAS ACTIVOS
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
        {filas.map((t) => {
          const n = activosPorTenant.get(t.id) ?? 0;
          return (
            <tr key={t.id} className="border-b border-border last:border-0">
              <td className={TD}>
                <div className="flex items-center gap-2.5">
                  <Avatar nombre={t.nombre} />
                  <span className="font-semibold">{t.nombre}</span>
                </div>
              </td>
              <td className={`${TD} font-mono`}>{n}</td>
              <td className={TD}>
                <Estado activo={t.activo} />
              </td>
              <td className={`${TD} text-right`}>
                {t.activo && (
                  <BajaCliente
                    tenantId={t.id}
                    nombre={t.nombre}
                    mercaderistasActivos={n}
                  />
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </Tarjeta>
  );
}

function Estado({ activo }: { activo: boolean }) {
  return activo ? (
    <span className="inline-flex rounded-full bg-completado-suave px-2.5 py-0.5 text-[11.5px] font-bold text-completado-texto">
      Activo
    </span>
  ) : (
    <span className="inline-flex rounded-full bg-alerta-suave px-2.5 py-0.5 text-[11.5px] font-bold text-alerta-texto">
      Inactivo
    </span>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-background p-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
