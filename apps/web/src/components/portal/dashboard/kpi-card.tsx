import type { Kpi } from "@/lib/portal/dashboard";
import { cn } from "@/lib/utils";

// Una tarjeta de KPI: valor grande + tendencia vs. período anterior. El color de
// la flecha depende de si "subir" es bueno para ese KPI (cumplimiento sí, quiebres
// no) — no de la dirección a secas.
export function KpiCard({ kpi }: { kpi: Kpi }) {
  const t = kpi.tendencia;

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-background p-4">
      <div className="text-[12px] font-semibold text-muted-foreground">
        {kpi.etiqueta}
      </div>
      <div className="text-2xl font-extrabold tracking-tight">{kpi.valor}</div>
      {t.disponible && t.direccion !== "igual" ? (
        <div
          className={cn(
            "text-[12px] font-semibold",
            (t.direccion === "sube") === kpi.subirEsBueno
              ? "text-completado-texto"
              : "text-alerta-texto",
          )}
        >
          <span aria-hidden="true">{t.direccion === "sube" ? "▲" : "▼"}</span>{" "}
          {Math.abs(t.delta)} vs. período anterior
        </div>
      ) : (
        <div className="text-[12px] text-muted-foreground">
          {t.disponible ? "Sin cambios" : "Sin comparación"}
        </div>
      )}
    </div>
  );
}
