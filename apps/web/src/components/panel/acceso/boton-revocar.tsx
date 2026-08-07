"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { revocarPase } from "@/lib/panel/acciones-acceso";

// Revocar mata el pase antes de que venza. Es la única acción de la bitácora, y
// solo QUITA acceso — por eso no pide confirmación: el daño de un clic accidental
// es que alguien tenga que pedir otro pase.

export function BotonRevocar({ paseId }: { paseId: string }) {
  const router = useRouter();
  const [pendiente, arrancar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function revocar() {
    setError(null);
    arrancar(async () => {
      const r = await revocarPase({ paseId });
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={revocar}
        disabled={pendiente}
        className="min-h-11 rounded-lg border border-border px-3 text-[12px] font-semibold disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {pendiente ? "Revocando…" : "Revocar"}
      </button>
      <p role="alert" className="text-[11.5px] text-alerta-texto empty:hidden">
        {error ?? ""}
      </p>
    </div>
  );
}
