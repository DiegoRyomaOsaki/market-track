"use client";

import { useRouter } from "next/navigation";

import { campo, etiqueta } from "@/components/panel/campos";

type Cliente = { id: string; nombre: string };

// El selector de cliente de la sección: al cambiar, navega con `?cliente=` para
// que el server component recargue la config de ese cliente.
export function SelectorCliente({
  clientes,
  seleccionado,
}: {
  clientes: Cliente[];
  seleccionado: string;
}) {
  const router = useRouter();

  return (
    <label className="flex max-w-xs flex-col gap-1.5">
      <span className={etiqueta}>Cliente</span>
      <select
        value={seleccionado}
        onChange={(e) =>
          router.push(
            `/admin/portal?cliente=${encodeURIComponent(e.target.value)}`,
          )
        }
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
  );
}
