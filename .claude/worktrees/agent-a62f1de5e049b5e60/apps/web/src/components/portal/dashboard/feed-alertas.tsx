import type { SeveridadAlerta, TipoAlerta } from "@market-track/shared";

import {
  ESTILO_SEVERIDAD,
  ETIQUETA_SEVERIDAD,
  ETIQUETA_TIPO_ALERTA,
} from "@/lib/portal/alertas";
import { cn } from "@/lib/utils";

// El feed de alertas recientes del dashboard: tipo · severidad · tienda · hora.
// Los datos vienen de `dashboard_alertas` (acotado por los filtros). La gestión
// completa (tabla + ciclo de estado) es MAR-57; esto es solo el vistazo.

export type AlertaFeed = {
  id: string;
  tipo: TipoAlerta;
  severidad: SeveridadAlerta;
  tienda_nombre: string;
  creado_at: string;
};

function formatoHora(iso: string): string {
  return new Date(iso).toLocaleString("es-PE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FeedAlertas({ alertas }: { alertas: AlertaFeed[] }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
      <h2 className="text-[13px] font-bold">Alertas recientes</h2>
      {alertas.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Sin alertas en el período y los filtros seleccionados.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {alertas.map((a) => (
            <li key={a.id} className="flex items-start gap-2.5 py-2.5">
              <span
                className={cn(
                  "mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide",
                  ESTILO_SEVERIDAD[a.severidad],
                )}
              >
                {ETIQUETA_SEVERIDAD[a.severidad]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold">
                  {ETIQUETA_TIPO_ALERTA[a.tipo]}
                </div>
                <div className="truncate text-[11.5px] text-muted-foreground">
                  {a.tienda_nombre} · {formatoHora(a.creado_at)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
