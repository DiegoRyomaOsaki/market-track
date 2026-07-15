import type { Metadata } from "next";

import { SaludoSesion } from "@/components/saludo-sesion";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Panel de administración — Market Track",
};

export default async function AdminPage() {
  const supabase = await createServerSupabaseClient();
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
