import type { Metadata } from "next";

import { SeccionPlaceholder } from "@/components/panel/seccion-placeholder";

export const metadata: Metadata = {
  title: "Precios y promociones — Market Track",
};

export default function PreciosPage() {
  return <SeccionPlaceholder titulo="Precios y promociones" />;
}
