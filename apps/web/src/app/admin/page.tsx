import { SaludoSesion } from "@/components/saludo-sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export default async function AdminPage() {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return (
    <SaludoSesion
      titulo="Panel de administración"
      email={user?.email ?? null}
    />
  );
}
