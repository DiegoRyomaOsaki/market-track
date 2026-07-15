import { SaludoSesion } from "@/components/saludo-sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export default async function ClientePage() {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return (
    <SaludoSesion titulo="Portal del cliente" email={user?.email ?? null} />
  );
}
