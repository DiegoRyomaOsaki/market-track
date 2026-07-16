"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { desactivarCliente } from "@/lib/usuarios/acciones";

// Da de baja un cliente-marca mostrando la CONSECUENCIA antes de confirmar: N
// mercaderistas perderán el acceso (derivado, se revoca solo). El diálogo (Radix)
// atrapa el foco, cierra con Escape y lo devuelve al disparador.
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
    <AlertDialog open={abierto} onOpenChange={setAbierto}>
      <AlertDialogTrigger className="rounded-md border border-border px-2.5 py-1.5 text-[12.5px] font-semibold text-alerta hover:bg-alerta-suave">
        Dar de baja
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Dar de baja a {nombre}</AlertDialogTitle>
        <AlertDialogDescription>
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
        </AlertDialogDescription>
        {error && (
          <p role="alert" className="mt-2 text-[13px] text-alerta">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault(); // no cerrar hasta que la acción termine bien
              void confirmar();
            }}
            disabled={enviando}
            className="bg-alerta text-alerta-foreground hover:opacity-90"
          >
            {enviando ? "Dando de baja…" : "Dar de baja"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
