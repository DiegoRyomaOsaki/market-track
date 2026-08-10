"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { campo, Errores, etiqueta, Pie } from "@/components/panel/campos";
import { crearCategoria, editarCategoria } from "@/lib/catalogo/acciones";
import { leerCampo, leerCasilla } from "@/lib/formulario";

// Alta y edición de una categoría de producto.
//
// La categoría cuelga del CLIENTE, no de la marca: "Bebidas" agrupa SKUs de
// varias marcas suyas, y así es como el cliente mira su negocio.

type Categoria = {
  id: string;
  nombre: string;
  tenant_id: string;
  codigo_externo: string | null;
  activo: boolean;
};

type Cliente = { id: string; nombre: string };

const VOLVER = "/admin/catalogo?vista=categorias";

export function FormCategoria({
  categoria,
  clientes,
}: {
  categoria?: Categoria;
  clientes: Cliente[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const datos = {
      nombre: leerCampo(fd, "nombre"),
      tenant_id: leerCampo(fd, "tenant_id"),
      codigo_externo: leerCampo(fd, "codigo_externo"),
      activo: leerCasilla(fd, "activo"),
    };
    const r = categoria
      ? await editarCategoria(categoria.id, datos)
      : await crearCategoria(datos);

    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.push(VOLVER);
    router.refresh();
  }

  if (clientes.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-background p-10 text-center text-sm text-muted-foreground">
        Una categoría cuelga de un cliente y todavía no hay ninguno.
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
          <span className={etiqueta}>Nombre de la categoría</span>
          <input
            name="nombre"
            required
            defaultValue={categoria?.nombre}
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Cliente</span>
          <select
            name="tenant_id"
            required
            defaultValue={categoria?.tenant_id ?? ""}
            className={campo}
          >
            <option value="" disabled>
              Elige un cliente…
            </option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Código externo (opcional)</span>
          <input
            name="codigo_externo"
            defaultValue={categoria?.codigo_externo ?? ""}
            className={campo}
          />
        </label>
      </div>

      {/* Sin código externo el importador no la puede reconocer: crearía una
          categoría nueva en cada carga en vez de actualizar esta. */}
      <p className="text-[12px] text-muted-foreground">
        El código externo es el que usa el cliente en su Excel. Sin él, la
        importación no puede reconocer esta categoría y crearía otra.
      </p>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="activo"
          defaultChecked={categoria?.activo ?? true}
          className="size-4"
        />
        <span className={etiqueta}>Activa</span>
      </label>

      <Errores error={error} />
      <Pie enviando={enviando} editando={!!categoria} volverA={VOLVER} />
    </form>
  );
}
