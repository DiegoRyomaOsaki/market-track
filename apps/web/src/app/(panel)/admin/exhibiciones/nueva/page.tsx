import type { Metadata } from "next";

import { FormExhibicion } from "@/components/comercial/form-exhibicion";
import {
  marcasActivas,
  skusActivos,
  tiendasActivas,
} from "@/lib/comercial/opciones-datos";

export const metadata: Metadata = { title: "Nueva exhibición — Market Track" };

export default async function NuevaExhibicionPage() {
  const [tiendas, marcas, skus] = await Promise.all([
    tiendasActivas(),
    marcasActivas(),
    skusActivos(),
  ]);

  return <FormExhibicion tiendas={tiendas} marcas={marcas} skus={skus} />;
}
