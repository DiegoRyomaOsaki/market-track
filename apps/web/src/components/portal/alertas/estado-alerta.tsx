"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { EstadoAlerta } from "@market-track/shared";

import { accionesDeEstado, ETIQUETA_ESTADO } from "@/lib/portal/alertas";
import { marcarEstadoAlerta } from "@/lib/portal/acciones-alertas";

// El ciclo de triage de una alerta. Client Component porque es lo único
// interactivo del detalle; el resto de la pantalla se pinta en el servidor.
//
// Escribe SOLO el estado, y no por elección de esta pantalla: el grant de la base
// está restringido a esa columna, así que la evidencia es inmutable aunque
// alguien llame a PostgREST por su cuenta.

export function EstadoDeAlerta({
  alertaId,
  estado,
}: {
  alertaId: string;
  estado: EstadoAlerta;
}) {
  const router = useRouter();
  const [pendiente, arrancar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function cambiar(nuevo: EstadoAlerta) {
    setError(null);
    arrancar(async () => {
      const r = await marcarEstadoAlerta({ alertaId, estado: nuevo });
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-muted-foreground">
          Estado actual: <strong>{ETIQUETA_ESTADO[estado]}</strong>
        </span>
        {accionesDeEstado(estado).map(({ estado: destino, verbo }) => (
          <button
            key={destino}
            type="button"
            onClick={() => cambiar(destino)}
            disabled={pendiente}
            className="min-h-11 rounded-lg border border-border px-3 text-[12px] font-semibold disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {pendiente ? "Guardando…" : verbo}
          </button>
        ))}
      </div>
      {error === null ? null : (
        <p role="alert" className="text-[12px] text-alerta-texto">
          {error}
        </p>
      )}
    </div>
  );
}
