import Link from "next/link";

import { botonPrimario, enlaceTabla } from "@/components/panel/estilos";
import { Paginacion } from "@/components/panel/paginacion";
import { Aviso, Tarjeta, TD, TH } from "@/components/panel/tabla";
import { paginar, rangoDe } from "@/lib/panel/listado";
import { tenantActivo } from "@/lib/panel/tenant-activo";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Los espacios de exhibición negociados por tienda, del cliente activo.
//
// La cuenta de SKUs va como número y no como lista: una cabecera puede llevar
// veinte y la tabla dejaría de leerse. El detalle está en el formulario.

const RUTA = "/admin/exhibiciones";

export async function VistaExhibiciones({ pagina }: { pagina: number }) {
  const tenant = await tenantActivo();

  const barra = (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex-1" />
      <Link href={`${RUTA}/nueva`} className={botonPrimario}>
        + Nueva exhibición
      </Link>
    </div>
  );

  if (!tenant) {
    return (
      <div className="flex flex-col gap-4">
        {barra}
        <Aviso>
          No hay ningún cliente activo del que mostrar exhibiciones.
        </Aviso>
      </div>
    );
  }

  const supabase = await createServerSupabaseClient();
  const [desde, hasta] = rangoDe(pagina);
  const { data, error } = await supabase
    .from("exhibicion_negociada")
    .select(
      "id, tipo, sku_ids, cantidad_sugerida, fecha_inicio, fecha_fin, tienda:exh_neg_tienda_fk(nombre), marca:exh_neg_marca_fk(nombre)",
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
        <Aviso>No se pudieron cargar las exhibiciones.</Aviso>
      ) : vaciaFueraDeRango ? (
        <Aviso>
          Esta página está vacía.{" "}
          <Link href={RUTA} className={enlaceTabla}>
            Volver a la primera
          </Link>
        </Aviso>
      ) : filas.length === 0 ? (
        <Aviso>
          Aún no hay exhibiciones negociadas de {tenant.nombre}. El mercaderista
          verifica en campo que se cumplan; si faltan, se dispara una alerta.
        </Aviso>
      ) : (
        <>
          <Tarjeta>
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th scope="col" className={TH}>
                  TIENDA
                </th>
                <th scope="col" className={TH}>
                  MARCA
                </th>
                <th scope="col" className={TH}>
                  TIPO
                </th>
                <th scope="col" className={TH}>
                  SKUS
                </th>
                <th scope="col" className={TH}>
                  UNIDADES
                </th>
                <th scope="col" className={TH}>
                  VIGENCIA
                </th>
                <th scope="col" className={TH}>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filas.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0">
                  <td className={`${TD} font-semibold`}>
                    {e.tienda?.nombre ?? "—"}
                  </td>
                  <td className={`${TD} text-muted-foreground`}>
                    {e.marca?.nombre ?? "—"}
                  </td>
                  <td className={TD}>{e.tipo}</td>
                  <td className={`${TD} tabular-nums text-muted-foreground`}>
                    {e.sku_ids.length === 0 ? "Sin definir" : e.sku_ids.length}
                  </td>
                  <td className={`${TD} tabular-nums text-muted-foreground`}>
                    {e.cantidad_sugerida ?? "—"}
                  </td>
                  <td className={`${TD} tabular-nums text-muted-foreground`}>
                    {e.fecha_inicio} → {e.fecha_fin}
                  </td>
                  <td className={`${TD} text-right`}>
                    <Link href={`${RUTA}/${e.id}`} className={enlaceTabla}>
                      Editar
                      <span className="sr-only">
                        {" "}
                        la exhibición de {e.marca?.nombre ??
                          "esta marca"} en {e.tienda?.nombre ?? "esta tienda"}
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
            href={(p) => `${RUTA}?p=${p}`}
          />
        </>
      )}
    </div>
  );
}
