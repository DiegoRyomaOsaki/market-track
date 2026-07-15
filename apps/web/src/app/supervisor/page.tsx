import { SaludoSesion } from "@/components/saludo-sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export default async function SupervisorPage() {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return (
    <SaludoSesion titulo="Panel de supervisión" email={user?.email ?? null} />
  );
}
