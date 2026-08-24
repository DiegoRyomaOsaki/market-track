import Link from "next/link";

import { botonPrimario, enlaceTabla } from "@/components/panel/estilos";
import { Paginacion } from "@/components/panel/paginacion";
import { Aviso, Pastilla, Tarjeta, TD, TH } from "@/components/panel/tabla";
import { soles } from "@/lib/formato";
import { paginar, rangoDe } from "@/lib/panel/listado";
import { tenantActivo } from "@/lib/panel/tenant-activo";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Las promociones del cliente activo, con su vigencia.
//
// Ordenadas por fecha de inicio descendente: lo que se consulta es lo que está
// vigente o a punto de empezar, no lo de hace seis meses. Acotadas al cliente
// del header por lo mismo que los precios: sin el `eq`, el índice por
// `(tenant_id, fecha_inicio)` no puede servir el orden.

const RUTA = "/admin/precios?vista=promociones";

export async function VistaPromociones({ pagina }: { pagina: number }) {
  const tenant = await tenantActivo();

  const barra = (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex-1" />
      <Link href="/admin/precios/promociones/nueva" className={botonPrimario}>
        + Nueva promoción
      </Link>
    </div>
  );

  if (!tenant) {
    return (
      <div className="flex flex-col gap-4">
        {barra}
        <Aviso>No hay ningún cliente activo del que mostrar promociones.</Aviso>
      </div>
    );
  }

  const supabase = await createServerSupabaseClient();
  const [desde, hasta] = rangoDe(pagina);
  const { data, error } = await supabase
    .from("promocion")
    .select(
      "id, precio_promo, fecha_inicio, fecha_fin, clusters, comunicada, sku:promocion_sku_fk(codigo, nombre)",
    )
    .eq("tenant_id", tenant.id)
    .order("fecha_inicio", { ascending: false })
    .order("id")
    .range(desde, hasta);

  const { filas, hayAnterior, haySiguiente, vaciaFueraDeRango } = paginar(
    data ?? [],
    pagina,
  );

  return (
    <div className="flex flex-col gap-4">
      {barra}

      {error ? (
        <Aviso>No se pudieron cargar las promociones.</Aviso>
      ) : vaciaFueraDeRango ? (
        <Aviso>
          Esta página está vacía.{" "}
          <Link href={RUTA} className={enlaceTabla}>
            Volver a la primera
          </Link>
        </Aviso>
      ) : filas.length === 0 ? (
        <Aviso>
          Aún no hay promociones de {tenant.nombre}. El motor de alertas las
          compara contra lo que el mercaderista levanta en góndola.
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
                  PRECIO PROMO
                </th>
                <th scope="col" className={TH}>
                  VIGENCIA
                </th>
                <th scope="col" className={TH}>
                  CLUSTERS
                </th>
                <th scope="col" className={TH}>
                  EN TIENDA
                </th>
                <th scope="col" className={TH}>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filas.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className={TD}>
                    <span className="font-semibold">
                      {p.sku?.nombre ?? "—"}
                    </span>
                    <span className="ml-2 font-mono text-muted-foreground">
                      {p.sku?.codigo ?? ""}
                    </span>
                  </td>
                  <td className={`${TD} font-semibold tabular-nums`}>
                    {soles(p.precio_promo)}
                  </td>
                  <td className={`${TD} tabular-nums text-muted-foreground`}>
                    {p.fecha_inicio} → {p.fecha_fin}
                  </td>
                  <td className={`${TD} text-muted-foreground`}>
                    {p.clusters.length === 0
                      ? "Todas las tiendas"
                      : p.clusters.join(", ")}
                  </td>
                  <td className={TD}>
                    {/* La píldora lleva SIEMPRE texto: el color no es el único
                      portador del significado. */}
                    {p.comunicada ? (
                      <Pastilla tono="bg-completado-suave text-completado-texto">
                        Comunicada
                      </Pastilla>
                    ) : (
                      <Pastilla tono="bg-muted text-muted-foreground">
                        Sin comunicar
                      </Pastilla>
                    )}
                  </td>
                  <td className={`${TD} text-right`}>
                    <Link
                      href={`/admin/precios/promociones/${p.id}`}
                      className={enlaceTabla}
                    >
                      Editar
                      <span className="sr-only">
                        {" "}
                        la promoción de {p.sku?.nombre ?? "este SKU"}
                      </span>
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
            href={(p) => `${RUTA}&p=${p}`}
          />
        </>
      )}
    </div>
  );
}
