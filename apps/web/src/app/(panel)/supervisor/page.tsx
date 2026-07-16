import type { Metadata } from "next";

import { SeccionPlaceholder } from "@/components/panel/seccion-placeholder";

export const metadata: Metadata = { title: "Tablero del día — Market Track" };

export default function TableroPage() {
  return <SeccionPlaceholder titulo="Tablero del día" />;
}
