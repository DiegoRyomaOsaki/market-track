"use client";

import { Constants } from "@market-track/db";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { campo, Errores, etiqueta, Pie } from "@/components/panel/campos";
import {
  BuscadorOpcion,
  type OpcionBusqueda,
} from "@/components/panel/buscador-opcion";
import { crearPrecio, editarPrecio } from "@/lib/comercial/acciones";
import { buscarSkus } from "@/lib/comercial/buscar-opciones";
import { leerCampo } from "@/lib/formulario";

import { SIN_CATALOGO, type OpcionCadena } from "./opciones";

// Alta y edición del precio regular de un SKU en una cadena.
//
// El catálogo llega acotado al cliente activo del header, y el SKU se BUSCA en
// vez de precargarse: un cliente puede tener 5.000 y un <select> con todos era
// la pantalla más pesada del panel.
//
// El cliente de la fila no se elige: lo trae el SKU elegido. La cookie del
// header solo decide qué catálogo se ofrece; la autoridad es la FK compuesta
// `(sku_id, tenant_id)`, que rechaza cualquier mezcla.

type Precio = {
  id: string;
  sku_id: string;
  cadena_id: string;
  tipo_tienda: string | null;
  precio: number;
  vigente_desde: string;
};

const VOLVER = "/admin/precios";

export function FormPrecio({
  precio,
  tenantId,
  skuInicial = null,
  cadenas,
}: {
  precio?: Precio;
  /** El cliente cuyo catálogo se ofrece: el activo al crear, el del precio al editar. */
  tenantId: string;
  /** El SKU ya guardado, resuelto por id por la página (edición). */
  skuInicial?: OpcionBusqueda | null;
  cadenas: OpcionCadena[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [skuElegido, setSkuElegido] = useState<OpcionBusqueda | null>(
    skuInicial,
  );
  const router = useRouter();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const datos = {
      tenant_id: skuElegido?.tenant_id ?? "",
      sku_id: leerCampo(fd, "sku_id"),
      cadena_id: leerCampo(fd, "cadena_id"),
      tipo_tienda: leerCampo(fd, "tipo_tienda") || null,
      precio: Number(leerCampo(fd, "precio")),
      vigente_desde: leerCampo(fd, "vigente_desde"),
    };

    const r = precio
      ? await editarPrecio(precio.id, datos)
      : await crearPrecio(datos);

    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.push(VOLVER);
    router.refresh();
  }

  if (cadenas.length === 0) {
    return <p className={SIN_CATALOGO.clase}>{SIN_CATALOGO.precio}</p>;
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="flex max-w-xl flex-col gap-4 rounded-xl border border-border bg-background p-6"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BuscadorOpcion
          etiqueta="SKU"
          nombreCampo="sku_id"
          placeholder="Busca por código o nombre…"
          buscar={buscarSkus}
          tenantId={tenantId}
          valorInicial={skuInicial}
          alElegir={setSkuElegido}
        />

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Cadena</span>
          <select
            name="cadena_id"
            required
            defaultValue={precio?.cadena_id ?? ""}
            className={campo}
          >
            <option value="" disabled>
              Elige una cadena…
            </option>
            {cadenas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Tipo de tienda (opcional)</span>
          {/* Vacío = el precio aplica a toda la cadena, sea cual sea el formato. */}
          <select
            name="tipo_tienda"
            defaultValue={precio?.tipo_tienda ?? ""}
            className={campo}
          >
            <option value="">Toda la cadena</option>
            {Constants.public.Enums.tipo_tienda.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Precio regular (S/)</span>
          <input
            name="precio"
            type="number"
            step="0.01"
            min="0"
            required
            defaultValue={precio?.precio}
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Vigente desde</span>
          <input
            name="vigente_desde"
            type="date"
            required
            defaultValue={precio?.vigente_desde}
            className={campo}
          />
        </label>
      </div>

      {/* Que la fecha forme parte de la clave no es obvio: sin decirlo, quien
          quiere subir el precio edita el de siempre y borra el histórico. */}
      <p className="text-[12px] text-muted-foreground">
        La fecha de vigencia forma parte de la identidad del precio. Para
        cambiarlo a partir de un día, da de alta uno nuevo con esa fecha en vez
        de editar este.
      </p>

      <Errores error={error} />
      <Pie enviando={enviando} editando={!!precio} volverA={VOLVER} />
    </form>
  );
}
