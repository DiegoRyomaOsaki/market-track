import type { Metadata } from "next";

import { SeccionPlaceholder } from "@/components/panel/seccion-placeholder";

export const metadata: Metadata = { title: "Catálogo — Market Track" };

export default function CatalogoPage() {
  return <SeccionPlaceholder titulo="Catálogo" />;
}
