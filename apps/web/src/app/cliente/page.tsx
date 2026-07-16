import type { Metadata } from "next";

import { SaludoSesion } from "@/components/saludo-sesion";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Portal del cliente — Market Track",
};

export default async function ClientePage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return (
    <SaludoSesion titulo="Portal del cliente" email={user?.email ?? null} />
  );
}
