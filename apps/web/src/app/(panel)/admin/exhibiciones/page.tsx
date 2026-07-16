import type { Metadata } from "next";

import { SeccionPlaceholder } from "@/components/panel/seccion-placeholder";

export const metadata: Metadata = {
  title: "Exhibiciones negociadas — Market Track",
};

export default function ExhibicionesPage() {
  return <SeccionPlaceholder titulo="Exhibiciones negociadas" />;
}
