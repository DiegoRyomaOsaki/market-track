import { Aviso } from "@/components/panel/tabla";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { type FilaCodificado, MatrizCodificados } from "./matriz-codificados";

const selector =
  "h-[38px] rounded-[9px] border border-border bg-background px-3 text-[13px]";

/**
 * La matriz de codificados de UNA tienda. Nunca se cargan todas las tiendas ×
 * todos los SKU a la vez: se elige una tienda y se traen solo sus SKU
 * (opcionalmente los de una marca). El grueso lo pone la importación del Excel;
 * esta pantalla es para correcciones.
 */
export async function VistaCodificados({
  tiendaId,
}: {
  tiendaId: string | undefined;
}) {
  const supabase = await createServerSupabaseClient();

  const { data: tiendas } = await supabase
    .from("tienda")
    .select("id, nombre, tenant_id, cadena:tienda_cadena_fk(nombre)")
    .eq("activo", true)
    .order("nombre");

  const tienda = tiendas?.find((t) => t.id === tiendaId);

  return (
    <div className="flex flex-col gap-4">
      <form
        action="/admin/catalogo"
        className="flex flex-wrap items-center gap-3"
      >
        <input type="hidden" name="vista" value="codificados" />
        <label className="flex items-center gap-2 text-[13px] font-semibold">
          Tienda
          <select
            name="tienda"
            defaultValue={tiendaId ?? ""}
            className={selector}
            aria-label="Elegir tienda"
          >
            <option value="">Elige una tienda…</option>
            {(tiendas ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.cadena?.nombre ? `${t.cadena.nombre} · ` : ""}
                {t.nombre}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="flex h-[38px] items-center rounded-[9px] border border-border bg-background px-4 text-[13px] font-semibold hover:bg-muted"
        >
          Ver
        </button>
      </form>

      {!tienda ? (
        <Aviso>
          Elige una tienda para ver y editar qué SKU están codificados en ella.
        </Aviso>
      ) : (
        <MatrizDeTienda
          tiendaId={tienda.id}
          tenantId={tienda.tenant_id}
          nombreTienda={tienda.nombre}
        />
      )}
    </div>
  );
}

async function MatrizDeTienda({
  tiendaId,
  tenantId,
  nombreTienda,
}: {
  tiendaId: string;
  tenantId: string;
  nombreTienda: string;
}) {
  const supabase = await createServerSupabaseClient();

  // Solo los SKU del cliente de esta tienda, y solo los codificados de ESTA
  // tienda: dos consultas acotadas, no la matriz entera.
  const [{ data: skus, error: errSkus }, { data: codificados }] =
    await Promise.all([
      supabase
        .from("sku")
        .select("id, codigo, nombre, marca:sku_marca_fk(nombre)")
        .eq("tenant_id", tenantId)
        .eq("activo", true)
        .order("codigo"),
      supabase
        .from("tienda_sku")
        .select("sku_id, activo")
        .eq("tienda_id", tiendaId),
    ]);

  if (errSkus) return <Aviso>No se pudieron cargar los SKUs.</Aviso>;
  if ((skus?.length ?? 0) === 0) {
    return (
      <Aviso>
        El cliente de esta tienda todavía no tiene SKUs. Créalos en la pestaña
        SKUs.
      </Aviso>
    );
  }

  const activoPorSku = new Map(
    (codificados ?? []).map((c) => [c.sku_id, c.activo]),
  );

  const filas: FilaCodificado[] = (skus ?? []).map((s) => ({
    sku_id: s.id,
    codigo: s.codigo,
    nombre: s.nombre,
    marca: s.marca?.nombre ?? "—",
    codificado: activoPorSku.get(s.id) ?? false,
  }));

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[11.5px] font-semibold text-muted-foreground">
        CODIFICADOS · {nombreTienda}
      </h2>
      <MatrizCodificados tiendaId={tiendaId} filas={filas} />
    </section>
  );
}
