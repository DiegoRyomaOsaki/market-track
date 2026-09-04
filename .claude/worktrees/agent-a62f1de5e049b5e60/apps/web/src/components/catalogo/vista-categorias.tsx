import Link from "next/link";

import {
  botonPrimario,
  buscador,
  enlaceTabla,
} from "@/components/panel/estilos";
import { Aviso, Estado, Tarjeta, TD, TH } from "@/components/panel/tabla";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Las categorías de producto de cada cliente.
//
// Es el eje por el que se pondera Perfect Store: el puntaje no se agrupa por SKU
// sino por categoría y tipo de tienda. Se cuenta cuántos SKUs cuelgan de cada una
// porque una categoría vacía no pondera nada — y eso no se ve de otro modo.

export async function VistaCategorias({ busqueda }: { busqueda: string }) {
  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from("categoria")
    .select(
      "id, nombre, codigo_externo, activo, tenant:tenant_id(nombre), sku(count)",
    )
    .order("nombre");
  if (busqueda) {
    query = query.ilike("nombre", `%${busqueda}%`);
  }

  const { data, error } = await query;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <form action="/admin/catalogo">
          <input type="hidden" name="vista" value="categorias" />
          <input
            name="q"
            defaultValue={busqueda}
            placeholder="Buscar por nombre…"
            aria-label="Buscar categoría por nombre"
            className={buscador}
          />
        </form>
        <div className="flex-1" />
        <Link href="/admin/catalogo/categorias/nueva" className={botonPrimario}>
          + Nueva categoría
        </Link>
      </div>

      {error ? (
        <Aviso>No se pudieron cargar las categorías.</Aviso>
      ) : (data?.length ?? 0) === 0 ? (
        <Aviso>
          {busqueda
            ? "Ninguna categoría coincide con la búsqueda."
            : "Aún no hay categorías. Son el eje por el que Perfect Store pondera el puntaje; el grueso entra por la importación del Excel."}
        </Aviso>
      ) : (
        <Tarjeta>
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th scope="col" className={TH}>
                CATEGORÍA
              </th>
              <th scope="col" className={TH}>
                CÓDIGO EXTERNO
              </th>
              <th scope="col" className={TH}>
                CLIENTE
              </th>
              <th scope="col" className={TH}>
                SKUS
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
            {(data ?? []).map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0">
                <td className={`${TD} font-semibold`}>{c.nombre}</td>
                <td className={`${TD} font-mono text-muted-foreground`}>
                  {c.codigo_externo ?? "—"}
                </td>
                <td className={`${TD} text-muted-foreground`}>
                  {c.tenant?.nombre ?? "—"}
                </td>
                <td className={`${TD} tabular-nums text-muted-foreground`}>
                  {c.sku[0]?.count ?? 0}
                </td>
                <td className={TD}>
                  <Estado activo={c.activo} />
                </td>
                <td className={`${TD} text-right`}>
                  <Link
                    href={`/admin/catalogo/categorias/${c.id}`}
                    className={enlaceTabla}
                  >
                    Editar
                    <span className="sr-only"> la categoría {c.nombre}</span>
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
