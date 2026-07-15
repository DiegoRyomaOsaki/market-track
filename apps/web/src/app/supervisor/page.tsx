import type { Metadata } from "next";

import { SaludoSesion } from "@/components/saludo-sesion";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Panel de supervisión — Market Track",
};

export default async function SupervisorPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return (
    <SaludoSesion titulo="Panel de supervisión" email={user?.email ?? null} />
  );
}
