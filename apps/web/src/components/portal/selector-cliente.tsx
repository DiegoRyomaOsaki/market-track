"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { campo, etiqueta } from "@/components/panel/campos";
import { botonSecundario } from "@/components/panel/estilos";

type Cliente = { id: string; nombre: string };

// El selector de cliente de la sección. La navegación ocurre al pulsar "Ver",
// NO al cambiar el select: navegar en cada `onChange` es el antipatrón de "menú
// de salto" (WCAG 3.2.2) —un teclado dispararía una navegación por cada tecla—.
export function SelectorCliente({
  clientes,
  seleccionado,
}: {
  clientes: Cliente[];
  seleccionado: string;
}) {
  const [valor, setValor] = useState(seleccionado);
  const router = useRouter();

  return (
    <div className="flex items-end gap-3">
      <label className="flex max-w-xs flex-1 flex-col gap-1.5">
        <span className={etiqueta}>Cliente</span>
        <select
          value={valor}
          onChange={(e) => setValor(e.target.value)}
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
      <button
        type="button"
        onClick={() =>
          valor &&
          router.push(`/admin/portal?cliente=${encodeURIComponent(valor)}`)
        }
        disabled={!valor || valor === seleccionado}
        className={`${botonSecundario} disabled:opacity-60`}
      >
        Ver
      </button>
    </div>
  );
}
