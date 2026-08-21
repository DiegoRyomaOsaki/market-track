import type { Metadata } from "next";

import { FormExhibicion } from "@/components/comercial/form-exhibicion";
import { Aviso } from "@/components/panel/tabla";
import { marcasActivas } from "@/lib/comercial/opciones-datos";
import { tenantActivo } from "@/lib/panel/tenant-activo";

export const metadata: Metadata = { title: "Nueva exhibición — Market Track" };

export default async function NuevaExhibicionPage() {
  const tenant = await tenantActivo();
  if (!tenant) {
    return (
      <Aviso>No hay ningún cliente activo para negociar exhibiciones.</Aviso>
    );
  }

  const marcas = await marcasActivas(tenant.id);
  return <FormExhibicion tenantId={tenant.id} marcas={marcas} />;
}
