import type { Metadata } from "next";

import { PantallaAcceso } from "@/components/panel/acceso/pantalla-acceso";

export const metadata: Metadata = { title: "Acceso y 2FA — Market Track" };

// Los pases vencen a los 15 minutos y su estado cambia mientras se trabaja:
// servir una versión cacheada enseñaría como vigente algo que ya no lo está.
export const dynamic = "force-dynamic";

export default function AccesoAdminPage() {
  return <PantallaAcceso esAdmin />;
}
