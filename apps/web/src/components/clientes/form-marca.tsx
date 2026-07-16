"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { crearMarca, editarMarca } from "@/lib/clientes/acciones";
import { leerCampo, leerCasilla } from "@/lib/formulario";

import { campo, Errores, etiqueta, Pie } from "./campos";

type Marca = {
  id: string;
  nombre: string;
  tenant_id: string;
  tolerancia_precio_pct: number;
  codigo_externo: string | null;
  activo: boolean;
};

type Cliente = { id: string; nombre: string };

export function FormMarca({
  marca,
  clientes,
}: {
  marca?: Marca;
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
      // El input numérico entrega texto; "" (vacío) no es 0, y mandarlo como 0
      // apagaría las alertas de la marca en silencio. Se deja pasar NaN para que
      // Zod lo rechace con su mensaje.
      tolerancia_precio_pct: Number(leerCampo(fd, "tolerancia_precio_pct")),
      codigo_externo: leerCampo(fd, "codigo_externo"),
      activo: leerCasilla(fd, "activo"),
    };
    const r = marca
      ? await editarMarca(marca.id, datos)
      : await crearMarca(datos);

    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  if (clientes.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-background p-10 text-center text-sm text-muted-foreground">
        Una marca cuelga de un cliente y todavía no hay ninguno. Crea primero el
        cliente.
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
          <span className={etiqueta}>Nombre de la marca</span>
          <input
            name="nombre"
            required
            defaultValue={marca?.nombre}
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Cliente</span>
          <select
            name="tenant_id"
            required
            defaultValue={marca?.tenant_id ?? ""}
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
          <span className={etiqueta}>Tolerancia de precio (%)</span>
          <input
            name="tolerancia_precio_pct"
            type="number"
            required
            min={0}
            max={100}
            step={0.01}
            defaultValue={marca?.tolerancia_precio_pct ?? 0}
            className={campo}
          />
          <span className="text-[12px] text-muted-foreground">
            Cuánto puede desviarse el precio en piso antes de alertar. Es por
            marca: 0% alerta ante cualquier desviación.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Código externo (opcional)</span>
          <input
            name="codigo_externo"
            defaultValue={marca?.codigo_externo ?? ""}
            className={campo}
          />
          <span className="text-[12px] text-muted-foreground">
            El código de esta marca en el Excel del cliente.
          </span>
        </label>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="activo"
          defaultChecked={marca?.activo ?? true}
          className="size-4"
        />
        <span className={etiqueta}>Activa</span>
      </label>

      <Errores error={error} />
      <Pie enviando={enviando} editando={!!marca} />
    </form>
  );
}
