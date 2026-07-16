"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { crearCliente, editarCliente } from "@/lib/clientes/acciones";
import { leerCampo, leerCasilla } from "@/lib/formulario";

import { campo, Errores, etiqueta, Pie } from "./campos";

type Cliente = { id: string; nombre: string; activo: boolean };

/**
 * Alta y edición de cliente en el mismo formulario: los campos son los mismos y
 * dos copias se separarían al primer cambio. `cliente` ausente = alta.
 */
export function FormCliente({ cliente }: { cliente?: Cliente }) {
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
      activo: leerCasilla(fd, "activo"),
    };
    const r = cliente
      ? await editarCliente(cliente.id, datos)
      : await crearCliente(datos);

    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="flex max-w-xl flex-col gap-4 rounded-xl border border-border bg-background p-6"
    >
      <label className="flex flex-col gap-1.5">
        <span className={etiqueta}>Nombre del cliente</span>
        <input
          name="nombre"
          required
          defaultValue={cliente?.nombre}
          className={campo}
        />
        <span className="text-[12px] text-muted-foreground">
          El cliente es la empresa que contrata; sus marcas se dan de alta
          aparte.
        </span>
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="activo"
          defaultChecked={cliente?.activo ?? true}
          className="size-4"
        />
        <span className={etiqueta}>Activo</span>
      </label>

      <Errores error={error} />
      <Pie enviando={enviando} editando={!!cliente} />
    </form>
  );
}
