import type { Metadata } from "next";

import { Aviso } from "@/components/panel/tabla";
import { requerirModulo } from "@/lib/portal/estado-modulos";

export const metadata: Metadata = { title: "Reportes — Market Track" };

export default async function ReportesPortalPage() {
  await requerirModulo("reportes");
  return (
    <Aviso>El configurador de reportes y la exportación llegan pronto.</Aviso>
  );
}
