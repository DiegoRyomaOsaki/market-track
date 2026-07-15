import type { Database } from "@market-track/db";
import { createBrowserClient } from "@supabase/ssr";

import { env } from "@/lib/env";

/** Cliente Supabase para el navegador (Client Components). La anon key es pública; RLS la contiene. */
export function crearClienteNavegador() {
  return createBrowserClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
}
