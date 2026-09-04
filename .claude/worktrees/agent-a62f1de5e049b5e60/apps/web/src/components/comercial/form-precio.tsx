"use client";

import { Constants } from "@market-track/db";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { campo, Errores, etiqueta, Pie } from "@/components/panel/campos";
import { crearPrecio, editarPrecio } from "@/lib/comercial/acciones";
import { leerCampo } from "@/lib/formulario";

import { SIN_CATALOGO, type OpcionCadena, type OpcionSku } from "./opciones";

// Alta y edición del precio regular de un SKU en una cadena.
//
// El cliente no se elige: lo trae el SKU. Un selector aparte podría no coincidir
// con el del SKU y la FK compuesta `(sku_id, tenant_id)` rechazaría la escritura
// con un mensaje que no le dice nada al operador.

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
  skus,
  cadenas,
}: {
  precio?: Precio;
  skus: OpcionSku[];
  cadenas: OpcionCadena[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [skuId, setSkuId] = useState(precio?.sku_id ?? skus[0]?.id ?? "");
  const [cadenaId, setCadenaId] = useState(precio?.cadena_id ?? "");
  const router = useRouter();

  const skuElegido = skus.find((s) => s.id === skuId);
  // Solo las cadenas del mismo cliente: la FK es compuesta y la base rechazaría
  // el resto. Filtrarlo aquí es UX; quien lo impide de verdad es la base.
  const cadenasDelCliente = cadenas.filter(
    (c) => c.tenant_id === skuElegido?.tenant_id,
  );

  function elegirSku(nuevoSkuId: string) {
    setSkuId(nuevoSkuId);
    // La cadena se limpia con el SKU. Un `<select>` no controlado cuya opción
    // desaparece de la lista lo sustituye EN SILENCIO por el primero de la
    // nueva: el operador enviaría una cadena que nunca eligió.
    setCadenaId("");
  }

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

  if (skus.length === 0 || cadenas.length === 0) {
    return <p className={SIN_CATALOGO.clase}>{SIN_CATALOGO.precio}</p>;
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="flex max-w-xl flex-col gap-4 rounded-xl border border-border bg-background p-6"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>SKU</span>
          <select
            name="sku_id"
            required
            value={skuId}
            onChange={(e) => elegirSku(e.target.value)}
            className={campo}
          >
            {skus.map((s) => (
              <option key={s.id} value={s.id}>
                {s.codigo} · {s.nombre} ({s.cliente})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Cadena</span>
          <select
            name="cadena_id"
            required
            value={cadenaId}
            onChange={(e) => setCadenaId(e.target.value)}
            className={campo}
          >
            <option value="" disabled>
              Elige una cadena…
            </option>
            {cadenasDelCliente.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
          {cadenasDelCliente.length === 0 && (
            <span className="text-[12px] text-muted-foreground">
              {skuElegido?.cliente ?? "Este cliente"} no tiene cadenas en el
              catálogo todavía.
            </span>
          )}
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
