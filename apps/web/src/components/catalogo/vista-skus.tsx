import Link from "next/link";

import {
  botonPrimario,
  buscador,
  enlaceTabla,
} from "@/components/panel/estilos";
import { Paginacion } from "@/components/panel/paginacion";
import {
  Avatar,
  Aviso,
  Estado,
  Tarjeta,
  TD,
  TH,
} from "@/components/panel/tabla";
import { escaparPatronIlike, paginar, rangoDe } from "@/lib/panel/listado";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function VistaSkus({
  busqueda,
  pagina,
}: {
  busqueda: string;
  pagina: number;
}) {
  const supabase = await createServerSupabaseClient();
  // El SKU cuelga de la marca; se muestra la marca y su cliente para ubicarlo.
  let query = supabase
    .from("sku")
    .select(
      "id, codigo, nombre, presentacion, codigo_barras, activo, marca:sku_marca_fk(nombre, tenant:tenant_id(nombre))",
    )
    .order("codigo")
    .order("id")
    .range(...rangoDe(pagina));
  if (busqueda) {
    // Busca por código o por nombre: el maestro es grande y se teclea uno u
    // otro. El término va escapado: sin ello, una coma parte el `.or` en un
    // filtro que no existe.
    const patron = `%${escaparPatronIlike(busqueda)}%`;
    query = query.or(`codigo.ilike.${patron},nombre.ilike.${patron}`);
  }

  const { data, error } = await query;
  const { filas, hayAnterior, haySiguiente, vaciaFueraDeRango } = paginar(
    data ?? [],
    pagina,
  );
  const href = (p: number) =>
    `/admin/catalogo?vista=skus&q=${encodeURIComponent(busqueda)}&p=${p}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <form action="/admin/catalogo">
          <input type="hidden" name="vista" value="skus" />
          <input
            name="q"
            defaultValue={busqueda}
            placeholder="Buscar por código o nombre…"
            aria-label="Buscar SKU por código o nombre"
            className={buscador}
          />
        </form>
        <div className="flex-1" />
        <Link href="/admin/catalogo/skus/nueva" className={botonPrimario}>
          + Nuevo SKU
        </Link>
      </div>

      {error ? (
        <Aviso>No se pudieron cargar los SKUs.</Aviso>
      ) : vaciaFueraDeRango ? (
        <Aviso>
          Esta página está vacía.{" "}
          <Link href={href(1)} className={enlaceTabla}>
            Volver a la primera
          </Link>
        </Aviso>
      ) : filas.length === 0 ? (
        <Aviso>
          {busqueda
            ? "Ningún SKU coincide con la búsqueda."
            : "Aún no hay SKUs. Cada SKU cuelga de una marca; el grueso entra por la importación del Excel."}
        </Aviso>
      ) : (
        <>
          <Tarjeta>
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th scope="col" className={TH}>
                  SKU
                </th>
                <th scope="col" className={TH}>
                  CÓDIGO
                </th>
                <th scope="col" className={TH}>
                  MARCA
                </th>
                <th scope="col" className={TH}>
                  CLIENTE
                </th>
                <th scope="col" className={TH}>
                  PRESENTACIÓN
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
              {filas.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className={TD}>
                    <div className="flex items-center gap-2.5">
                      <Avatar nombre={s.nombre} />
                      <span className="font-semibold">{s.nombre}</span>
                    </div>
                  </td>
                  <td className={`${TD} font-mono`}>{s.codigo}</td>
                  <td className={`${TD} text-muted-foreground`}>
                    {s.marca?.nombre ?? "—"}
                  </td>
                  <td className={`${TD} text-muted-foreground`}>
                    {s.marca?.tenant?.nombre ?? "—"}
                  </td>
                  <td className={`${TD} text-muted-foreground`}>
                    {s.presentacion ?? "—"}
                  </td>
                  <td className={TD}>
                    <Estado activo={s.activo} />
                  </td>
                  <td className={`${TD} text-right`}>
                    <Link
                      href={`/admin/catalogo/skus/${s.id}`}
                      className={enlaceTabla}
                    >
                      Editar<span className="sr-only"> el SKU {s.nombre}</span>
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
      )}
    </div>
  );
}
