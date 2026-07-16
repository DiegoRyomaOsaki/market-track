"use client";

import { Constants } from "@market-track/db";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { campo, Errores, etiqueta, Pie } from "@/components/panel/campos";
import { crearCadena, editarCadena } from "@/lib/catalogo/acciones";
import { leerCampo, leerCasilla } from "@/lib/formulario";

type Cadena = {
  id: string;
  nombre: string;
  tenant_id: string;
  tipo_tienda: string | null;
  codigo_externo: string | null;
  activo: boolean;
};

type Cliente = { id: string; nombre: string };

export function FormCadena({
  cadena,
  clientes,
}: {
  cadena?: Cadena;
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
      tipo_tienda: leerCampo(fd, "tipo_tienda") || null,
      codigo_externo: leerCampo(fd, "codigo_externo"),
      activo: leerCasilla(fd, "activo"),
    };
    const r = cadena
      ? await editarCadena(cadena.id, datos)
      : await crearCadena(datos);

    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.push("/admin/catalogo");
    router.refresh();
  }

  if (clientes.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-background p-10 text-center text-sm text-muted-foreground">
        Una cadena cuelga de un cliente y todavía no hay ninguno.
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
          <span className={etiqueta}>Nombre de la cadena</span>
          <input
            name="nombre"
            required
            defaultValue={cadena?.nombre}
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Cliente</span>
          <select
            name="tenant_id"
            required
            defaultValue={cadena?.tenant_id ?? ""}
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
          <span className={etiqueta}>Tipo de tienda (opcional)</span>
          {/* Los valores salen del enum de la base, no de una lista a mano. */}
          <select
            name="tipo_tienda"
            defaultValue={cadena?.tipo_tienda ?? ""}
            className={campo}
          >
            <option value="">—</option>
            {Constants.public.Enums.tipo_tienda.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Código externo (opcional)</span>
          <input
            name="codigo_externo"
            defaultValue={cadena?.codigo_externo ?? ""}
            className={campo}
          />
        </label>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="activo"
          defaultChecked={cadena?.activo ?? true}
          className="size-4"
        />
        <span className={etiqueta}>Activa</span>
      </label>

      <Errores error={error} />
      <Pie enviando={enviando} editando={!!cadena} volverA="/admin/catalogo" />
    </form>
  );
}
