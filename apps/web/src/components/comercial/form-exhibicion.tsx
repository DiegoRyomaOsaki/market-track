"use client";

import { Constants } from "@market-track/db";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { campo, Errores, etiqueta, Pie } from "@/components/panel/campos";
import {
  BuscadorOpcion,
  type OpcionBusqueda,
} from "@/components/panel/buscador-opcion";
import { crearExhibicion, editarExhibicion } from "@/lib/comercial/acciones";
import { buscarSkus, buscarTiendas } from "@/lib/comercial/buscar-opciones";
import { leerCampo } from "@/lib/formulario";

import { SIN_CATALOGO, type OpcionMarca } from "./opciones";

// Alta y edición del espacio de exhibición que una marca negocia en una tienda.
//
// La negocia UNA MARCA, no el cliente entero: la misma tienda puede tener a la
// vez una cabecera de una marca y una isla de otra. Tienda y SKUs se BUSCAN en
// el catálogo del cliente activo en vez de precargarse; los SKUs elegidos se
// acumulan como fichas porque son varios.

type Exhibicion = {
  id: string;
  tienda_id: string;
  marca_id: string;
  tipo: string;
  sku_ids: string[];
  cantidad_sugerida: number | null;
  fecha_inicio: string;
  fecha_fin: string;
};

const VOLVER = "/admin/exhibiciones";

export function FormExhibicion({
  exhibicion,
  tenantId,
  tiendaInicial = null,
  marcas,
  skusIniciales = [],
}: {
  exhibicion?: Exhibicion;
  /** El cliente cuyo catálogo se ofrece: el activo al crear, el de la exhibición al editar. */
  tenantId: string;
  /** La tienda ya guardada, resuelta por id por la página (edición). */
  tiendaInicial?: OpcionBusqueda | null;
  marcas: OpcionMarca[];
  /** Los SKUs ya guardados, resueltos por id por la página (edición). */
  skusIniciales?: OpcionBusqueda[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [tiendaElegida, setTiendaElegida] = useState<OpcionBusqueda | null>(
    tiendaInicial,
  );
  const [skusElegidos, setSkusElegidos] =
    useState<OpcionBusqueda[]>(skusIniciales);
  const router = useRouter();

  function agregarSku(opcion: OpcionBusqueda | null) {
    if (opcion === null) return;
    setSkusElegidos((previos) =>
      previos.some((s) => s.id === opcion.id) ? previos : [...previos, opcion],
    );
  }

  function quitarSku(id: string) {
    setSkusElegidos((previos) => previos.filter((s) => s.id !== id));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    // La cantidad es opcional: en blanco es "sin cantidad pactada", no cero.
    // `Number("")` da 0, que es un compromiso de cero unidades — otra cosa.
    const cantidad = leerCampo(fd, "cantidad_sugerida");
    const datos = {
      tenant_id: tiendaElegida?.tenant_id ?? "",
      tienda_id: leerCampo(fd, "tienda_id"),
      marca_id: leerCampo(fd, "marca_id"),
      tipo: leerCampo(fd, "tipo"),
      sku_ids: skusElegidos.map((s) => s.id),
      cantidad_sugerida: cantidad === "" ? null : Number(cantidad),
      fecha_inicio: leerCampo(fd, "fecha_inicio"),
      fecha_fin: leerCampo(fd, "fecha_fin"),
    };

    const r = exhibicion
      ? await editarExhibicion(exhibicion.id, datos)
      : await crearExhibicion(datos);

    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.push(VOLVER);
    router.refresh();
  }

  if (marcas.length === 0) {
    return <p className={SIN_CATALOGO.clase}>{SIN_CATALOGO.exhibicion}</p>;
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="flex max-w-xl flex-col gap-4 rounded-xl border border-border bg-background p-6"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BuscadorOpcion
          etiqueta="Tienda"
          nombreCampo="tienda_id"
          placeholder="Busca por nombre…"
          buscar={buscarTiendas}
          tenantId={tenantId}
          valorInicial={tiendaInicial}
          alElegir={setTiendaElegida}
        />

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Marca que lo negocia</span>
          <select
            name="marca_id"
            required
            defaultValue={exhibicion?.marca_id ?? ""}
            className={campo}
          >
            <option value="" disabled>
              Elige una marca…
            </option>
            {marcas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Tipo de espacio</span>
          {/* Del enum de la base, no de una lista a mano. */}
          <select
            name="tipo"
            required
            defaultValue={exhibicion?.tipo ?? ""}
            className={campo}
          >
            <option value="" disabled>
              Elige un tipo…
            </option>
            {Constants.public.Enums.tipo_exhibicion.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Unidades pactadas (opcional)</span>
          <input
            name="cantidad_sugerida"
            type="number"
            min="0"
            step="1"
            defaultValue={exhibicion?.cantidad_sugerida ?? ""}
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Desde</span>
          <input
            name="fecha_inicio"
            type="date"
            required
            defaultValue={exhibicion?.fecha_inicio}
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Hasta</span>
          <input
            name="fecha_fin"
            type="date"
            required
            defaultValue={exhibicion?.fecha_fin}
            className={campo}
          />
        </label>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className={etiqueta}>SKUs que ocupan el espacio</legend>
        <BuscadorOpcion
          etiqueta="Añadir SKU"
          placeholder="Busca por código o nombre…"
          buscar={buscarSkus}
          tenantId={tenantId}
          alElegir={agregarSku}
          limpiarAlElegir
        />
        {skusElegidos.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {skusElegidos.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-[12.5px]"
              >
                {s.etiqueta}
                <button
                  type="button"
                  onClick={() => quitarSku(s.id)}
                  aria-label={`Quitar ${s.etiqueta}`}
                  className="font-semibold text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* Se negocia el espacio antes de decidir qué entra en él: dejarlo
            vacío es un caso normal, no un olvido. */}
        <p className="text-[12px] text-muted-foreground">
          Se puede dejar vacío si aún no está decidido qué SKUs lo ocupan.
        </p>
      </fieldset>

      <Errores error={error} />
      <Pie enviando={enviando} editando={!!exhibicion} volverA={VOLVER} />
    </form>
  );
}
