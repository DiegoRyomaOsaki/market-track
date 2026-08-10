import type { Metadata } from "next";

import { PantallaAcceso } from "@/components/panel/acceso/pantalla-acceso";

export const metadata: Metadata = { title: "Acceso y 2FA — Market Track" };

export const dynamic = "force-dynamic";

// El supervisor emite pases y ve la bitácora de SUS mercaderistas. Quien acota
// las filas es la RLS, no esta ruta: la política de canales de OTP no se le
// ofrece porque su `update` moriría en la base de todas formas.
export default function AccesoSupervisorPage() {
  return <PantallaAcceso esAdmin={false} />;
}
