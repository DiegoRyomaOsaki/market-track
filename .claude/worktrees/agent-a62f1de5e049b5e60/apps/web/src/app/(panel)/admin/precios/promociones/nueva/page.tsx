import type { Metadata } from "next";

import { FormPromocion } from "@/components/comercial/form-promocion";
import {
  clustersPorCliente,
  skusActivos,
} from "@/lib/comercial/opciones-datos";

export const metadata: Metadata = { title: "Nueva promoción — Market Track" };

export default async function NuevaPromocionPage() {
  const [skus, clusters] = await Promise.all([
    skusActivos(),
    clustersPorCliente(),
  ]);

  return <FormPromocion skus={skus} clustersPorCliente={clusters} />;
}
