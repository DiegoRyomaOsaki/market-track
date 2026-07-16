import type { RolUsuario } from "@market-track/shared";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";

// A dónde aterriza cada rol al entrar. Record EXHAUSTIVO: un rol nuevo en la base
// deja de compilar aquí en vez de mandar a nadie a una pantalla equivocada.
const DESTINO_POR_ROL: Record<RolUsuario, string> = {
  admin: "/admin",
  supervisor: "/supervisor",
  cliente: "/cliente",
  // El mercaderista trabaja en la app móvil: la web no tiene nada para él.
  mercaderista: "/login",
};

// Aterrizaje, no control de acceso: de eso se encargan el middleware y la RLS.
// Aquí solo se evita que el usuario tenga que adivinar su URL.
export default async function Home() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: perfil } = await supabase
    .from("profile")
    .select("rol")
    .eq("id", user.id)
    .single();

  redirect(perfil ? DESTINO_POR_ROL[perfil.rol] : "/login");
}
