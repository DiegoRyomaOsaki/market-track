import Link from "next/link";

import { botonPrimario, enlaceTabla } from "@/components/panel/estilos";
import { Paginacion } from "@/components/panel/paginacion";
import { Aviso, Tarjeta, TD, TH } from "@/components/panel/tabla";
import { paginar, rangoDe } from "@/lib/panel/listado";
import { tenantActivo } from "@/lib/panel/tenant-activo";
import { soles } from "@/lib/formato";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Los precios regulares vigentes por SKU y cadena, del cliente activo.
//
// Se acota al cliente del selector del header: la tabla nunca sobreescribe
// —cada corrección deja una fila más— y sin el `eq` el índice por
// `(tenant_id, vigente_desde)` no puede servir el orden.
//
// Se ordenan por fecha descendente porque la fecha forma parte de la identidad
// del precio: lo primero que quiere ver quien entra es el precio más reciente
// de cada SKU, no el histórico entero en orden alfabético.

const RUTA = "/admin/precios";

export async function VistaPrecios({ pagina }: { pagina: number }) {
  const tenant = await tenantActivo();

  const barra = (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex-1" />
      <Link href={`${RUTA}/nuevo`} className={botonPrimario}>
        + Nuevo precio
      </Link>
    </div>
  );

  if (!tenant) {
    return (
      <div className="flex flex-col gap-4">
        {barra}
        <Aviso>No hay ningún cliente activo del que mostrar precios.</Aviso>
      </div>
    );
  }

  const supabase = await createServerSupabaseClient();
  const [desde, hasta] = rangoDe(pagina);
  const { data, error } = await supabase
    .from("precio_regular")
    .select(
      "id, precio, tipo_tienda, vigente_desde, sku:precio_sku_fk(codigo, nombre), cadena:precio_cadena_fk(nombre)",
    )
    .eq("tenant_id", tenant.id)
    .order("vigente_desde", { ascending: false })
    // El desempate por id hace estable la paginación: muchas filas comparten
    // la misma fecha y sin él una fila puede repetirse o saltarse un corte.
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
        <Aviso>No se pudieron cargar los precios.</Aviso>
      ) : vaciaFueraDeRango ? (
        <Aviso>
          Esta página está vacía.{" "}
          <Link href={RUTA} className={enlaceTabla}>
            Volver a la primera
          </Link>
        </Aviso>
      ) : filas.length === 0 ? (
        <Aviso>
          Aún no hay precios regulares de {tenant.nombre}. El grueso entra por
          la importación del Excel del cliente; aquí se corrigen casos
          puntuales.
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
                    <Link href={`${RUTA}/${p.id}`} className={enlaceTabla}>
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
