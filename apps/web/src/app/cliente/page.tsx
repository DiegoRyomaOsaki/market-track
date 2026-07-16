import type { Metadata } from "next";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Portal del cliente — Market Track",
};

// Placeholder del portal del cliente. Su shell real (login multi-tenant, filtros
// globales) llega en su propio ticket; por ahora solo confirma la sesión.
export default async function ClientePage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-3 p-8">
      <h1 className="text-2xl font-semibold">Portal del cliente</h1>
      <p className="text-muted-foreground">
        Sesión iniciada como{" "}
        <span className="font-medium text-foreground">
          {user?.email ?? "—"}
        </span>
      </p>
    </main>
  );
}
