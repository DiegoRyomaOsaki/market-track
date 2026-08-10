import type { Metadata } from "next";

import { PantallaImportar } from "@/components/panel/importar/pantalla-importar";

export const metadata: Metadata = { title: "Importar Excel — Market Track" };

// El cliente-marca activo vive en una cookie y la pantalla se pinta a partir de
// él: una versión cacheada importaría sobre el cliente equivocado.
export const dynamic = "force-dynamic";

export default function ImportarPage() {
  return <PantallaImportar />;
}
