import type { Metadata } from "next";

import { FormCliente } from "@/components/clientes/form-cliente";

export const metadata: Metadata = { title: "Nuevo cliente — Market Track" };

export default function NuevoClientePage() {
  return <FormCliente />;
}
