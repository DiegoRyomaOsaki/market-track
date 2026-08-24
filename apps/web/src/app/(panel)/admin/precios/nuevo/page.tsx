import type { Metadata } from "next";

import { FormPrecio } from "@/components/comercial/form-precio";
import { Aviso } from "@/components/panel/tabla";
import { cadenasActivas } from "@/lib/comercial/opciones-datos";
import { tenantActivo } from "@/lib/panel/tenant-activo";

export const metadata: Metadata = { title: "Nuevo precio — Market Track" };

export default async function NuevoPrecioPage() {
  // El catálogo que se ofrece es el del cliente activo del header. Sin cliente
  // no hay contra qué dar de alta.
  const tenant = await tenantActivo();
  if (!tenant) {
    return (
      <Aviso>No hay ningún cliente activo para dar de alta precios.</Aviso>
    );
  }

  const cadenas = await cadenasActivas(tenant.id);
  return <FormPrecio tenantId={tenant.id} cadenas={cadenas} />;
}
