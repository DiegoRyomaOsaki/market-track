import type { Metadata } from "next";

import { VistaExhibiciones } from "@/components/comercial/vista-exhibiciones";

export const metadata: Metadata = {
  title: "Exhibiciones negociadas — Market Track",
};

export default function ExhibicionesPage() {
  return <VistaExhibiciones />;
}
