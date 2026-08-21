import type { Metadata } from "next";

import { FormPromocion } from "@/components/comercial/form-promocion";
import { Aviso } from "@/components/panel/tabla";
import { clustersDe } from "@/lib/comercial/opciones-datos";
import { tenantActivo } from "@/lib/panel/tenant-activo";

export const metadata: Metadata = { title: "Nueva promoción — Market Track" };

export default async function NuevaPromocionPage() {
  const tenant = await tenantActivo();
  if (!tenant) {
    return (
      <Aviso>No hay ningún cliente activo para dar de alta promociones.</Aviso>
    );
  }

  const clusters = await clustersDe(tenant.id);
  return <FormPromocion tenantId={tenant.id} clusters={clusters} />;
}
