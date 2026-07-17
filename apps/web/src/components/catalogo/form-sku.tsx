"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { campo, Errores, etiqueta, Pie } from "@/components/panel/campos";
import { crearSku, editarSku } from "@/lib/catalogo/acciones";
import { leerCampo, leerCasilla } from "@/lib/formulario";

type Sku = {
  id: string;
  nombre: string;
  codigo: string;
  marca_id: string;
  presentacion: string | null;
  codigo_barras: string | null;
  codigo_externo: string | null;
  activo: boolean;
};

type Marca = { id: string; nombre: string; tenant_id: string; cliente: string };

export function FormSku({ sku, marcas }: { sku?: Sku; marcas: Marca[] }) {
  const [marcaId, setMarcaId] = useState(sku?.marca_id ?? marcas[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();

  // El cliente no se elige: lo hereda la marca. Así no puede quedar un SKU
  // colgando de la marca de otro cliente (la FK compuesta también lo impide).
  const tenantDeLaMarca = marcas.find((m) => m.id === marcaId)?.tenant_id ?? "";

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const datos = {
      nombre: leerCampo(fd, "nombre"),
      tenant_id: tenantDeLaMarca,
      marca_id: marcaId,
      codigo: leerCampo(fd, "codigo"),
      presentacion: leerCampo(fd, "presentacion"),
      codigo_barras: leerCampo(fd, "codigo_barras"),
      codigo_externo: leerCampo(fd, "codigo_externo"),
      activo: leerCasilla(fd, "activo"),
    };
    const r = sku ? await editarSku(sku.id, datos) : await crearSku(datos);

    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.push("/admin/catalogo?vista=skus");
    router.refresh();
  }

  if (marcas.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-background p-10 text-center text-sm text-muted-foreground">
        Un SKU cuelga de una marca y todavía no hay ninguna. Crea primero la
        marca en Clientes-marca.
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="flex max-w-xl flex-col gap-4 rounded-xl border border-border bg-background p-6"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Nombre del SKU</span>
          <input
            name="nombre"
            required
            defaultValue={sku?.nombre}
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Marca</span>
          <select
            name="marca_id"
            required
            value={marcaId}
            onChange={(e) => setMarcaId(e.target.value)}
            className={campo}
          >
            {marcas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre} · {m.cliente}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Código</span>
          <input
            name="codigo"
            required
            defaultValue={sku?.codigo}
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Presentación (opcional)</span>
          <input
            name="presentacion"
            defaultValue={sku?.presentacion ?? ""}
            className={campo}
            placeholder="p. ej. 500 ml"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Código de barras (opcional)</span>
          <input
            name="codigo_barras"
            defaultValue={sku?.codigo_barras ?? ""}
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Código externo (opcional)</span>
          <input
            name="codigo_externo"
            defaultValue={sku?.codigo_externo ?? ""}
            className={campo}
          />
          <span className="text-[12px] text-muted-foreground">
            El código de este SKU en el Excel del cliente.
          </span>
        </label>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="activo"
          defaultChecked={sku?.activo ?? true}
          className="size-4"
        />
        <span className={etiqueta}>Activo</span>
      </label>

      <Errores error={error} />
      <Pie
        enviando={enviando}
        editando={!!sku}
        volverA="/admin/catalogo?vista=skus"
      />
    </form>
  );
}
