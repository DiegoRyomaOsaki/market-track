import Link from "next/link";

import { botonPrimario, enlaceTabla } from "@/components/panel/estilos";
import { Aviso, Tarjeta, TD, TH } from "@/components/panel/tabla";
import { acotar, TOPE_CONSULTA } from "@/lib/comercial/listado";
import { soles } from "@/lib/formato";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { AvisoTope } from "./aviso-tope";

// Los precios regulares vigentes por SKU y cadena.
//
// Se ordenan por fecha descendente porque la fecha forma parte de la identidad
// del precio: lo primero que quiere ver quien entra es el precio más reciente de
// cada SKU, no el histórico entero en orden alfabético.

export async function VistaPrecios() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("precio_regular")
    .select(
      "id, precio, tipo_tienda, vigente_desde, sku:precio_sku_fk(codigo, nombre), cadena:precio_cadena_fk(nombre)",
    )
    .order("vigente_desde", { ascending: false })
    .limit(TOPE_CONSULTA);

  const { filas, hayMas } = acotar(data ?? []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1" />
        <Link href="/admin/precios/nuevo" className={botonPrimario}>
          + Nuevo precio
        </Link>
      </div>

      {error ? (
        <Aviso>No se pudieron cargar los precios.</Aviso>
      ) : filas.length === 0 ? (
        <Aviso>
          Aún no hay precios regulares. El grueso entra por la importación del
          Excel del cliente; aquí se corrigen casos puntuales.
        </Aviso>
      ) : (
        <>
          <AvisoTope hayMas={hayMas} />
          <Tarjeta>
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th scope="col" className={TH}>
                  SKU
                </th>
                <th scope="col" className={TH}>
                  CADENA
                </th>
                <th scope="col" className={TH}>
                  TIPO DE TIENDA
                </th>
                <th scope="col" className={TH}>
                  PRECIO
                </th>
                <th scope="col" className={TH}>
                  VIGENTE DESDE
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
                  <td className={`${TD} text-muted-foreground`}>
                    {p.cadena?.nombre ?? "—"}
                  </td>
                  <td className={`${TD} text-muted-foreground`}>
                    {p.tipo_tienda ?? "Toda la cadena"}
                  </td>
                  <td className={`${TD} font-semibold tabular-nums`}>
                    {soles(p.precio)}
                  </td>
                  <td className={`${TD} tabular-nums text-muted-foreground`}>
                    {p.vigente_desde}
                  </td>
                  <td className={`${TD} text-right`}>
                    <Link
                      href={`/admin/precios/${p.id}`}
                      className={enlaceTabla}
                    >
                      Editar
                      <span className="sr-only">
                        {" "}
                        el precio de {p.sku?.nombre ?? "este SKU"}
                      </span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </Tarjeta>
        </>
      )}
    </div>
  );
}
