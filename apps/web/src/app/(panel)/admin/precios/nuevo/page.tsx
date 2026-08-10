import type { Metadata } from "next";

import { FormPrecio } from "@/components/comercial/form-precio";
import { cadenasActivas, skusActivos } from "@/lib/comercial/opciones-datos";

export const metadata: Metadata = { title: "Nuevo precio — Market Track" };

export default async function NuevoPrecioPage() {
  const [skus, cadenas] = await Promise.all([skusActivos(), cadenasActivas()]);

  return <FormPrecio skus={skus} cadenas={cadenas} />;
}
