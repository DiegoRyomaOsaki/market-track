"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { type ModuloPortal, moduloPortalSchema } from "@market-track/shared";

import { guardarModulosPortal } from "@/lib/portal/acciones";
import { ETIQUETA_MODULO, type EstadoModulos } from "@/lib/portal/modulos";

import { Errores, etiqueta, Pie } from "@/components/panel/campos";

// Las casillas por módulo de un cliente + guardar. El estado arranca del que
// resolvió el server (con el default coalesce) y se persiste con la acción.
export function FormModulos({
  tenantId,
  nombreCliente,
  estadoInicial,
}: {
  tenantId: string;
  nombreCliente: string;
  estadoInicial: EstadoModulos;
}) {
  const [estado, setEstado] = useState<EstadoModulos>(estadoInicial);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();

  function alternar(modulo: ModuloPortal, habilitado: boolean) {
    setEstado((prev) => ({ ...prev, [modulo]: habilitado }));
    setMensaje(null);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setError(null);

    const r = await guardarModulosPortal({
      tenant_id: tenantId,
      modulos: estado,
    });

    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setMensaje("Configuración guardada.");
    router.refresh();
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="flex max-w-xl flex-col gap-4 rounded-xl border border-border bg-background p-6"
    >
      <p className="text-[13px] text-muted-foreground">
        Secciones que <strong>{nombreCliente}</strong> verá en su portal. Una
        sección desactivada no se muestra ni es accesible por URL. Por defecto,
        todas están habilitadas.
      </p>

      <div className="flex flex-col gap-1">
        {moduloPortalSchema.options.map((modulo) => (
          <label
            key={modulo}
            className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0"
          >
            <span className={etiqueta}>{ETIQUETA_MODULO[modulo]}</span>
            <input
              type="checkbox"
              checked={estado[modulo]}
              onChange={(e) => alternar(modulo, e.target.checked)}
              className="size-4"
              aria-label={ETIQUETA_MODULO[modulo]}
            />
          </label>
        ))}
      </div>

      <Errores error={error} />
      {mensaje ? (
        <p
          role="status"
          className="rounded-[9px] bg-completado-suave px-3 py-2 text-[13px] font-semibold text-completado-texto"
        >
          {mensaje}
        </p>
      ) : null}
      <Pie enviando={enviando} editando volverA="/admin/portal" />
    </form>
  );
}
