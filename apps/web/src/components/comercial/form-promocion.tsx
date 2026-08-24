"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { campo, Errores, etiqueta, Pie } from "@/components/panel/campos";
import {
  BuscadorOpcion,
  type OpcionBusqueda,
} from "@/components/panel/buscador-opcion";
import { crearPromocion, editarPromocion } from "@/lib/comercial/acciones";
import { buscarSkus } from "@/lib/comercial/buscar-opciones";
import { leerCampo, leerCasilla } from "@/lib/formulario";

// Alta y edición de una promoción con vigencia.
//
// El SKU se busca en el catálogo del cliente activo, no se precarga. Los
// clusters se eligen de los que YA existen en las tiendas de ese cliente, no se
// teclean: `tienda.cluster` es texto libre y un cluster con una errata no
// acotaría nada — la promo saldría en todas las tiendas sin que nadie lo note.
// El catálogo de clusters como entidad propia es otro ticket.

type Promocion = {
  id: string;
  sku_id: string;
  precio_promo: number;
  fecha_inicio: string;
  fecha_fin: string;
  clusters: string[];
  comunicada: boolean;
};

const VOLVER = "/admin/precios?vista=promociones";

export function FormPromocion({
  promocion,
  tenantId,
  skuInicial = null,
  clusters,
}: {
  promocion?: Promocion;
  /** El cliente cuyo catálogo se ofrece: el activo al crear, el de la promo al editar. */
  tenantId: string;
  /** El SKU ya guardado, resuelto por id por la página (edición). */
  skuInicial?: OpcionBusqueda | null;
  /** Los clusters que existen en las tiendas de ESE cliente. */
  clusters: string[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [skuElegido, setSkuElegido] = useState<OpcionBusqueda | null>(
    skuInicial,
  );
  const [elegidos, setElegidos] = useState<string[]>(promocion?.clusters ?? []);
  const router = useRouter();

  function alternarCluster(cluster: string) {
    setElegidos((previos) =>
      previos.includes(cluster)
        ? previos.filter((c) => c !== cluster)
        : [...previos, cluster],
    );
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const datos = {
      tenant_id: skuElegido?.tenant_id ?? "",
      sku_id: leerCampo(fd, "sku_id"),
      precio_promo: Number(leerCampo(fd, "precio_promo")),
      fecha_inicio: leerCampo(fd, "fecha_inicio"),
      fecha_fin: leerCampo(fd, "fecha_fin"),
      clusters: elegidos,
      comunicada: leerCasilla(fd, "comunicada"),
    };

    const r = promocion
      ? await editarPromocion(promocion.id, datos)
      : await crearPromocion(datos);

    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.push(VOLVER);
    router.refresh();
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="flex max-w-xl flex-col gap-4 rounded-xl border border-border bg-background p-6"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BuscadorOpcion
          etiqueta="SKU en promoción"
          nombreCampo="sku_id"
          placeholder="Busca por código o nombre…"
          buscar={buscarSkus}
          tenantId={tenantId}
          valorInicial={skuInicial}
          alElegir={setSkuElegido}
        />

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Precio promocional (S/)</span>
          <input
            name="precio_promo"
            type="number"
            step="0.01"
            min="0"
            required
            defaultValue={promocion?.precio_promo}
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Desde</span>
          <input
            name="fecha_inicio"
            type="date"
            required
            defaultValue={promocion?.fecha_inicio}
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Hasta</span>
          <input
            name="fecha_fin"
            type="date"
            required
            defaultValue={promocion?.fecha_fin}
            className={campo}
          />
        </label>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className={etiqueta}>Clusters de tienda</legend>
        {clusters.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            Ninguna tienda tiene cluster asignado, así que la promoción aplica a
            todas.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {clusters.map((c) => (
                <label
                  key={c}
                  className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-[12.5px]"
                >
                  <input
                    type="checkbox"
                    checked={elegidos.includes(c)}
                    onChange={() => alternarCluster(c)}
                    className="size-4"
                  />
                  {c}
                </label>
              ))}
            </div>
            <p className="text-[12px] text-muted-foreground">
              Sin ninguno marcado, la promoción aplica a todas las tiendas.
            </p>
          </>
        )}
      </fieldset>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="comunicada"
          defaultChecked={promocion?.comunicada ?? false}
          className="size-4"
        />
        <span className={etiqueta}>
          Comunicada en tienda (cartel o encarte)
        </span>
      </label>
      {/* No es decoración: es la pregunta que bifurca el árbol de decisión de
          precios que el mercaderista recorre en el levantamiento. */}
      <p className="text-[12px] text-muted-foreground">
        Si está comunicada, el mercaderista debe ver el cartel en góndola; si no
        lo ve, se levanta como desviación.
      </p>

      <Errores error={error} />
      <Pie enviando={enviando} editando={!!promocion} volverA={VOLVER} />
    </form>
  );
}
