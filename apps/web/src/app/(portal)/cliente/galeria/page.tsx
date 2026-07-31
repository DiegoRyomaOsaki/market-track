import type { Metadata } from "next";

import { Aviso } from "@/components/panel/tabla";
import { requerirModulo } from "@/lib/portal/estado-modulos";

export const metadata: Metadata = { title: "Galería — Market Track" };

export default async function GaleriaPortalPage() {
  await requerirModulo("galeria");
  return (
    <Aviso>La galería de evidencia (fotos antes/después) llega pronto.</Aviso>
  );
}
