"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { crearFormulario } from "@/lib/formularios/acciones";
import { leerCampo } from "@/lib/formulario";

import { campo, Errores, etiqueta, Pie } from "@/components/panel/campos";

type Cliente = { id: string; nombre: string };
type Marca = { id: string; nombre: string; tenant_id: string };

// Alta de la CABECERA del formulario (cliente y marca opcional). Al crearlo se
// entra directo al constructor de la definición, que es donde está el trabajo.
export function FormFormulario({
  clientes,
  marcas,
}: {
  clientes: Cliente[];
  marcas: Marca[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const [marcaId, setMarcaId] = useState("");
  const router = useRouter();

  const marcasDelCliente = marcas.filter((m) => m.tenant_id === tenantId);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const r = await crearFormulario({
      nombre: leerCampo(fd, "nombre"),
      tenant_id: leerCampo(fd, "tenant_id"),
      marca_id: leerCampo(fd, "marca_id"),
    });

    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.push(`/admin/formularios/${r.id}`);
    router.refresh();
  }

  if (clientes.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-background p-10 text-center text-sm text-muted-foreground">
        El formulario se configura por cliente y todavía no hay ninguno. Crea
        primero el cliente.
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="flex max-w-xl flex-col gap-4 rounded-xl border border-border bg-background p-6"
    >
      <label className="flex flex-col gap-1.5">
        <span className={etiqueta}>Nombre del formulario</span>
        <input name="nombre" required className={campo} />
        <span className="text-[12px] text-muted-foreground">
          Un nombre para identificarlo en el panel (p. ej. «Levantamiento
          estándar»). No lo ve el mercaderista.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={etiqueta}>Cliente</span>
        <select
          name="tenant_id"
          required
          value={tenantId}
          onChange={(e) => {
            setTenantId(e.target.value);
            // Cambiar de cliente descarta la marca: la vieja es de otro cliente.
            setMarcaId("");
          }}
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
        <span className={etiqueta}>Marca (opcional)</span>
        <select
          name="marca_id"
          value={marcaId}
          onChange={(e) => setMarcaId(e.target.value)}
          className={campo}
          disabled={!tenantId}
        >
          <option value="">Todas las marcas del cliente</option>
          {marcasDelCliente.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre}
            </option>
          ))}
        </select>
        <span className="text-[12px] text-muted-foreground">
          Déjalo en «todas» para que aplique a cualquier marca del cliente, o
          elige una para un formulario específico de esa marca.
        </span>
      </label>

      <Errores error={error} />
      <Pie enviando={enviando} editando={false} volverA="/admin/formularios" />
    </form>
  );
}
