import type { Metadata } from "next";
import Link from "next/link";

import { BajaCliente } from "@/components/clientes/baja-cliente";
import {
  Avatar,
  Aviso,
  Estado,
  Tarjeta,
  TD,
  TH,
} from "@/components/panel/tabla";
import { Paginacion } from "@/components/panel/paginacion";
import {
  escaparPatronIlike,
  leerPagina,
  paginar,
  rangoDe,
} from "@/lib/panel/listado";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Clientes-marca — Market Track" };

function primero(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const BOTON_PRIMARIO =
  "flex h-[38px] items-center rounded-[9px] bg-primary px-4 text-[13px] font-semibold text-primary-foreground hover:opacity-90";
const BOTON_SECUNDARIO =
  "flex h-[38px] items-center rounded-[9px] border border-border bg-background px-4 text-[13px] font-semibold hover:bg-muted";

export default async function ClientesMarcaPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; p?: string | string[] }>;
}) {
  const params = await searchParams;
  const busqueda = (primero(params.q) ?? "").trim();
  const pagina = leerPagina(params.p);
  const supabase = await createServerSupabaseClient();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <form action="/admin">
          <input
            name="q"
            defaultValue={busqueda}
            placeholder="Buscar cliente o marca…"
            aria-label="Buscar por cliente o marca"
            className="h-[38px] w-[240px] rounded-[9px] border border-border bg-background px-3 text-[13px]"
          />
        </form>
        <div className="flex-1" />
        <Link href="/admin/clientes/nuevo" className={BOTON_SECUNDARIO}>
          + Nuevo cliente
        </Link>
        <Link href="/admin/marcas/nueva" className={BOTON_PRIMARIO}>
          + Nueva marca
        </Link>
      </div>

      <TablaMarcas supabase={supabase} busqueda={busqueda} pagina={pagina} />
      <TablaClientes supabase={supabase} busqueda={busqueda} />
    </div>
  );
}

type Supabase = Awaited<ReturnType<typeof createServerSupabaseClient>>;

async function TablaMarcas({
  supabase,
  busqueda,
  pagina,
}: {
  supabase: Supabase;
  busqueda: string;
  pagina: number;
}) {
  const href = (p: number) => `/admin?q=${encodeURIComponent(busqueda)}&p=${p}`;
  // El conteo de SKUs lo agrega Postgres; traerse los SKUs al panel para contarlos
  // sería traer el catálogo entero por una cifra.
  let query = supabase
    .from("marca")
    .select(
      "id, nombre, tolerancia_precio_pct, codigo_externo, activo, tenant:tenant_id(nombre), sku(count)",
    )
    .order("nombre")
    .order("id")
    .range(...rangoDe(pagina));
  if (busqueda)
    query = query.ilike("nombre", `%${escaparPatronIlike(busqueda)}%`);

  const { data, error } = await query;
  if (error) return <Aviso>No se pudieron cargar las marcas.</Aviso>;

  const { filas, hayAnterior, haySiguiente, vaciaFueraDeRango } = paginar(
    data ?? [],
    pagina,
  );
  if (vaciaFueraDeRango) {
    return (
      <Aviso>
        Esta página está vacía.{" "}
        <Link
          href={href(1)}
          className="text-[13px] font-semibold text-primary hover:underline"
        >
          Volver a la primera
        </Link>
      </Aviso>
    );
  }
  if (filas.length === 0) {
    return (
      <Aviso>
        {busqueda
          ? "Ninguna marca coincide con la búsqueda."
          : "Aún no hay marcas. El SKU cuelga de una marca: crea la primera para poder cargar catálogo."}
      </Aviso>
    );
  }

  return (
    <>
      <Tarjeta>
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th scope="col" className={TH}>
              MARCA
            </th>
            <th scope="col" className={TH}>
              CLIENTE
            </th>
            <th scope="col" className={TH}>
              TOL. PRECIO
            </th>
            <th scope="col" className={TH}>
              SKUs
            </th>
            <th scope="col" className={TH}>
              CÓDIGO EXTERNO
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
          {filas.map((m) => (
            <tr key={m.id} className="border-b border-border last:border-0">
              <td className={TD}>
                <div className="flex items-center gap-2.5">
                  <Avatar nombre={m.nombre} />
                  <span className="font-semibold">{m.nombre}</span>
                </div>
              </td>
              <td className={`${TD} text-muted-foreground`}>
                {m.tenant?.nombre ?? "—"}
              </td>
              <td className={`${TD} font-mono`}>
                ± {m.tolerancia_precio_pct}%
              </td>
              <td className={`${TD} font-mono`}>{m.sku[0]?.count ?? 0}</td>
              <td className={`${TD} font-mono text-muted-foreground`}>
                {m.codigo_externo ?? "—"}
              </td>
              <td className={TD}>
                <Estado activo={m.activo} />
              </td>
              <td className={`${TD} text-right`}>
                <Link
                  href={`/admin/marcas/${m.id}`}
                  className="text-[13px] font-semibold text-primary hover:underline"
                >
                  Editar<span className="sr-only"> la marca {m.nombre}</span>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </Tarjeta>
      <Paginacion
        pagina={pagina}
        hayAnterior={hayAnterior}
        haySiguiente={haySiguiente}
        href={href}
      />
    </>
  );
}

async function TablaClientes({
  supabase,
  busqueda,
}: {
  supabase: Supabase;
  busqueda: string;
}) {
  // Sin paginar a propósito: la tabla de clientes crece de contrato en
  // contrato, no de importación en importación.
  let query = supabase
    .from("tenant")
    .select("id, nombre, activo")
    .order("nombre");
  if (busqueda)
    query = query.ilike("nombre", `%${escaparPatronIlike(busqueda)}%`);

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
    return <Aviso>No se pudieron cargar los clientes.</Aviso>;
  }

  const filas = tenants ?? [];
  if (filas.length === 0) {
    return (
      <Aviso>
        {busqueda
          ? "Ningún cliente coincide con la búsqueda."
          : "No hay clientes."}
      </Aviso>
    );
  }

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
    <section className="flex flex-col gap-2">
      <h2 className="text-[11.5px] font-semibold text-muted-foreground">
        CLIENTES · un cliente tiene varias marcas; darlo de baja revoca el
        acceso de sus mercaderistas
      </h2>
      <Tarjeta>
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th scope="col" className={TH}>
              CLIENTE
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
                  <div className="flex items-center justify-end gap-3">
                    <Link
                      href={`/admin/clientes/${t.id}`}
                      className="text-[13px] font-semibold text-primary hover:underline"
                    >
                      Editar
                      <span className="sr-only"> el cliente {t.nombre}</span>
                    </Link>
                    {t.activo && (
                      <BajaCliente
                        tenantId={t.id}
                        nombre={t.nombre}
                        mercaderistasActivos={n}
                      />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Tarjeta>
    </section>
  );
}
