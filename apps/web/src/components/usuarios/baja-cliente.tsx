"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { desactivarCliente } from "@/lib/usuarios/acciones";

// Da de baja un cliente-marca mostrando la CONSECUENCIA antes de confirmar: N
// mercaderistas perderán el acceso (derivado, se revoca solo). Diálogo modal
// accesible por teclado.
export function BajaCliente({
  tenantId,
  nombre,
  mercaderistasActivos,
}: {
  tenantId: string;
  nombre: string;
  mercaderistasActivos: number;
}) {
  const [abierto, setAbierto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const cancelarRef = useRef<HTMLButtonElement>(null);

  async function confirmar() {
    setEnviando(true);
    setError(null);
    const r = await desactivarCliente(tenantId);
    setEnviando(false);
    if (r.ok) {
      setAbierto(false);
      router.refresh();
    } else {
      setError(r.error);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-md border border-border px-2.5 py-1 text-[12.5px] font-semibold text-alerta hover:bg-alerta-suave"
      >
        Dar de baja
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAbierto(false);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="baja-titulo"
            className="w-full max-w-md rounded-xl bg-background p-5 shadow-2xl"
          >
            <h2 id="baja-titulo" className="text-base font-bold">
              Dar de baja a {nombre}
            </h2>
            <p className="mt-2 text-[13px] text-muted-foreground">
              {mercaderistasActivos === 0 ? (
                "Este cliente no tiene mercaderistas activos."
              ) : (
                <>
                  <span className="font-semibold text-alerta-texto">
                    {mercaderistasActivos} mercaderista
                    {mercaderistasActivos === 1 ? "" : "s"}
                  </span>{" "}
                  perderá{mercaderistasActivos === 1 ? "" : "n"} el acceso de
                  inmediato. Al reactivar el cliente, quien fue desvinculado
                  individualmente NO vuelve.
                </>
              )}
            </p>
            {error && <p className="mt-2 text-[13px] text-alerta">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={cancelarRef}
                type="button"
                onClick={() => setAbierto(false)}
                className="rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmar()}
                disabled={enviando}
                className="rounded-md bg-alerta px-3 py-1.5 text-[13px] font-semibold text-alerta-foreground hover:opacity-90 disabled:opacity-50"
              >
                {enviando ? "Dando de baja…" : "Dar de baja"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
