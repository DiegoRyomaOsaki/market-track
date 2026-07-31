import type { Metadata } from "next";

import { Aviso } from "@/components/panel/tabla";
import { requerirModulo } from "@/lib/portal/estado-modulos";

export const metadata: Metadata = { title: "Dashboard — Market Track" };

export default async function DashboardPortalPage() {
  await requerirModulo("dashboard");
  return (
    <Aviso>
      El dashboard de KPIs, el mapa de tiendas y el feed de alertas llegan
      pronto.
    </Aviso>
  );
}
