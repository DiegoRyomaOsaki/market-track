import type { Metadata } from "next";

import { Aviso } from "@/components/panel/tabla";
import { requerirModulo } from "@/lib/portal/estado-modulos";

export const metadata: Metadata = { title: "Alertas — Market Track" };

export default async function AlertasPortalPage() {
  await requerirModulo("alertas");
  return (
    <Aviso>La tabla de alertas con su detalle y estado llega pronto.</Aviso>
  );
}
