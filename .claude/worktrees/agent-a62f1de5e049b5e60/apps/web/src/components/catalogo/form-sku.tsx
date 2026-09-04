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
  categoria_id: string | null;
  presentacion: string | null;
  codigo_barras: string | null;
  codigo_externo: string | null;
  activo: boolean;
};

type Marca = { id: string; nombre: string; tenant_id: string; cliente: string };
type Categoria = { id: string; nombre: string; tenant_id: string };

export function FormSku({
  sku,
  marcas,
  categorias,
}: {
  sku?: Sku;
  marcas: Marca[];
  categorias: Categoria[];
}) {
  const [marcaId, setMarcaId] = useState(sku?.marca_id ?? marcas[0]?.id ?? "");
  const [categoriaId, setCategoriaId] = useState(sku?.categoria_id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();

  // El cliente no se elige: lo hereda la marca. Así no puede quedar un SKU
  // colgando de la marca de otro cliente (la FK compuesta también lo impide).
  const tenantDeLaMarca = marcas.find((m) => m.id === marcaId)?.tenant_id ?? "";

  // Solo las categorías de ESE cliente. La FK compuesta lo impediría igual, pero
  // ofrecerlas sería enseñar una opción que el servidor va a rechazar.
  const categoriasDelCliente = categorias.filter(
    (c) => c.tenant_id === tenantDeLaMarca,
  );

  function elegirMarca(nuevaMarcaId: string) {
    const anterior = marcas.find((m) => m.id === marcaId)?.tenant_id;
    setMarcaId(nuevaMarcaId);
    // Solo si CAMBIA de cliente: dentro del mismo, la categoría elegida sigue
    // siendo válida. Al cambiar, deja de verse en la lista pero seguiría en el
    // estado y viajaría en el envío.
    const nuevo = marcas.find((m) => m.id === nuevaMarcaId)?.tenant_id;
    if (anterior !== nuevo) setCategoriaId("");
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const datos = {
      nombre: leerCampo(fd, "nombre"),
      tenant_id: tenantDeLaMarca,
      marca_id: marcaId,
      categoria_id: categoriaId === "" ? null : categoriaId,
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
            onChange={(e) => elegirMarca(e.target.value)}
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
          <span className={etiqueta}>Categoría (opcional)</span>
          {/* Opcional a propósito: el maestro se carga poco a poco y un SKU sin
              categoría tiene que poder existir. Perfect Store pondera por
              categoría, así que sin ella ese SKU no entra en el puntaje. */}
          <select
            name="categoria_id"
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
            className={campo}
          >
            <option value="">Sin categoría</option>
            {categoriasDelCliente.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
          {categoriasDelCliente.length === 0 && (
            <span className="text-[12px] text-muted-foreground">
              Este cliente no tiene categorías todavía.
            </span>
          )}
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
