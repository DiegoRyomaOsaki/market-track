import Link from "next/link";

import { botonPrimario, enlaceTabla } from "@/components/panel/estilos";
import { Aviso, Tarjeta, TD, TH } from "@/components/panel/tabla";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Los espacios de exhibición negociados por tienda.
//
// La cuenta de SKUs va como número y no como lista: una cabecera puede llevar
// veinte y la tabla dejaría de leerse. El detalle está en el formulario.

export async function VistaExhibiciones() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("exhibicion_negociada")
    .select(
      "id, tipo, sku_ids, cantidad_sugerida, fecha_inicio, fecha_fin, tienda:exh_neg_tienda_fk(nombre), marca:exh_neg_marca_fk(nombre)",
    )
    .order("fecha_inicio", { ascending: false });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1" />
        <Link href="/admin/exhibiciones/nueva" className={botonPrimario}>
          + Nueva exhibición
        </Link>
      </div>

      {error ? (
        <Aviso>No se pudieron cargar las exhibiciones.</Aviso>
      ) : (data?.length ?? 0) === 0 ? (
        <Aviso>
          Aún no hay exhibiciones negociadas. El mercaderista verifica en campo
          que se cumplan; si faltan, se dispara una alerta.
        </Aviso>
      ) : (
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
            {(data ?? []).map((e) => (
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
                  <Link
                    href={`/admin/exhibiciones/${e.id}`}
                    className={enlaceTabla}
                  >
                    Editar
                    <span className="sr-only">
                      {" "}
                      la exhibición de {e.marca?.nombre ?? "esta marca"} en{" "}
                      {e.tienda?.nombre ?? "esta tienda"}
                    </span>
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
