import { Aviso } from "@/components/panel/tabla";
import type { Kpi } from "@/lib/portal/dashboard";

import { KpiCard } from "./kpi-card";

// La fila de KPIs del dashboard. Los cálculos vienen de la base (dashboard_kpis);
// aquí solo se disponen las tarjetas.
export function KpisFila({ kpis }: { kpis: Kpi[] }) {
  if (kpis.length === 0) {
    return (
      <Aviso>No hay datos para el período y los filtros seleccionados.</Aviso>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      {kpis.map((kpi) => (
        <KpiCard key={kpi.clave} kpi={kpi} />
      ))}
    </div>
  );
}
