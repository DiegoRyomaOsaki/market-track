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
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Catálogo — Market Track" };

// El catálogo entra sobre todo por la importación del Excel del cliente
// (MAR-29/45); estas altas son para correcciones y casos puntuales.

function primero(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const BOTON_PRIMARIO =
  "flex h-[38px] items-center rounded-[9px] bg-primary px-4 text-[13px] font-semibold text-primary-foreground hover:opacity-90";
const BOTON_SECUNDARIO =
  "flex h-[38px] items-center rounded-[9px] border border-border bg-background px-4 text-[13px] font-semibold hover:bg-muted";
const ENLACE = "text-[13px] font-semibold text-primary hover:underline";

export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const busqueda = (primero((await searchParams).q) ?? "").trim();
  const supabase = await createServerSupabaseClient();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <form action="/admin/catalogo">
          <input
            name="q"
            defaultValue={busqueda}
            placeholder="Buscar tienda o cadena…"
            aria-label="Buscar por tienda o cadena"
            className="h-[38px] w-[240px] rounded-[9px] border border-border bg-background px-3 text-[13px]"
          />
        </form>
        <div className="flex-1" />
        <Link href="/admin/catalogo/cadenas/nueva" className={BOTON_SECUNDARIO}>
          + Nueva cadena
        </Link>
        <Link href="/admin/catalogo/tiendas/nueva" className={BOTON_PRIMARIO}>
          + Nueva tienda
        </Link>
      </div>

      <TablaTiendas supabase={supabase} busqueda={busqueda} />
      <TablaCadenas supabase={supabase} busqueda={busqueda} />
    </div>
  );
}

type Supabase = Awaited<ReturnType<typeof createServerSupabaseClient>>;

async function TablaTiendas({
  supabase,
  busqueda,
}: {
  supabase: Supabase;
  busqueda: string;
}) {
  // lat/lon son columnas generadas: se leen, nunca se escriben.
  //
  // `cadena:tienda_cadena_fk(...)` va por el NOMBRE de la constraint, no por la
  // columna: la FK a cadena es compuesta (cadena_id, tenant_id) — así la base
  // impide colgar una tienda de la cadena de otro cliente — y PostgREST no puede
  // deducir la relación desde `cadena_id` a secas.
  let query = supabase
    .from("tienda")
    .select(
      "id, nombre, direccion, cluster, codigo_externo, radio_geocerca_m, lat, lon, activo, cadena:tienda_cadena_fk(nombre), tenant:tenant_id(nombre)",
    )
    .order("nombre");
  if (busqueda) query = query.ilike("nombre", `%${busqueda}%`);

  const { data, error } = await query;
  if (error) return <Aviso>No se pudieron cargar las tiendas.</Aviso>;

  const filas = data ?? [];
  if (filas.length === 0) {
    return (
      <Aviso>
        {busqueda
          ? "Ninguna tienda coincide con la búsqueda."
          : "Aún no hay tiendas. Cada tienda necesita su ubicación y su geocerca para que el mercaderista pueda hacer check-in."}
      </Aviso>
    );
  }

  return (
    <Tarjeta>
      <thead>
        <tr className="border-b border-border bg-muted/40">
          <th scope="col" className={TH}>
            TIENDA
          </th>
          <th scope="col" className={TH}>
            CADENA
          </th>
          <th scope="col" className={TH}>
            CLIENTE
          </th>
          <th scope="col" className={TH}>
            GEOCERCA
          </th>
          <th scope="col" className={TH}>
            UBICACIÓN
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
        {filas.map((t) => (
          <tr key={t.id} className="border-b border-border last:border-0">
            <td className={TD}>
              <div className="flex items-center gap-2.5">
                <Avatar nombre={t.nombre} />
                <div className="flex flex-col">
                  <span className="font-semibold">{t.nombre}</span>
                  {t.direccion && (
                    <span className="text-[12px] text-muted-foreground">
                      {t.direccion}
                    </span>
                  )}
                </div>
              </div>
            </td>
            <td className={`${TD} text-muted-foreground`}>
              {t.cadena?.nombre ?? "—"}
            </td>
            <td className={`${TD} text-muted-foreground`}>
              {t.tenant?.nombre ?? "—"}
            </td>
            <td className={`${TD} font-mono`}>{t.radio_geocerca_m} m</td>
            <td className={`${TD} font-mono text-muted-foreground`}>
              {t.lat !== null && t.lon !== null
                ? `${t.lat.toFixed(4)}, ${t.lon.toFixed(4)}`
                : "sin ubicar"}
            </td>
            <td className={TD}>
              <Estado activo={t.activo} />
            </td>
            <td className={`${TD} text-right`}>
              <Link href={`/admin/catalogo/tiendas/${t.id}`} className={ENLACE}>
                Editar<span className="sr-only"> la tienda {t.nombre}</span>
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </Tarjeta>
  );
}

async function TablaCadenas({
  supabase,
  busqueda,
}: {
  supabase: Supabase;
  busqueda: string;
}) {
  let query = supabase
    .from("cadena")
    .select(
      "id, nombre, tipo_tienda, codigo_externo, activo, tenant:tenant_id(nombre), tienda:tienda_cadena_fk(count)",
    )
    .order("nombre");
  if (busqueda) query = query.ilike("nombre", `%${busqueda}%`);

  const { data, error } = await query;
  if (error) return <Aviso>No se pudieron cargar las cadenas.</Aviso>;

  const filas = data ?? [];
  if (filas.length === 0) {
    return (
      <Aviso>
        {busqueda
          ? "Ninguna cadena coincide con la búsqueda."
          : "Aún no hay cadenas. La tienda cuelga de una cadena: crea la primera."}
      </Aviso>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[11.5px] font-semibold text-muted-foreground">
        CADENAS · Plaza Vea, Tottus, Metro… cada tienda pertenece a una
      </h2>
      <Tarjeta>
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th scope="col" className={TH}>
              CADENA
            </th>
            <th scope="col" className={TH}>
              CLIENTE
            </th>
            <th scope="col" className={TH}>
              TIPO
            </th>
            <th scope="col" className={TH}>
              TIENDAS
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
          {filas.map((c) => (
            <tr key={c.id} className="border-b border-border last:border-0">
              <td className={TD}>
                <div className="flex items-center gap-2.5">
                  <Avatar nombre={c.nombre} />
                  <span className="font-semibold">{c.nombre}</span>
                </div>
              </td>
              <td className={`${TD} text-muted-foreground`}>
                {c.tenant?.nombre ?? "—"}
              </td>
              <td className={`${TD} text-muted-foreground`}>
                {c.tipo_tienda ?? "—"}
              </td>
              <td className={`${TD} font-mono`}>{c.tienda[0]?.count ?? 0}</td>
              <td className={TD}>
                <Estado activo={c.activo} />
              </td>
              <td className={`${TD} text-right`}>
                <Link
                  href={`/admin/catalogo/cadenas/${c.id}`}
                  className={ENLACE}
                >
                  Editar<span className="sr-only"> la cadena {c.nombre}</span>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </Tarjeta>
    </section>
  );
}
