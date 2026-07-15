import type { Database } from "@market-track/db";
import { createBrowserClient } from "@supabase/ssr";

import { env } from "@/lib/env";

/**
 * Cliente Supabase para el navegador (Client Components). La anon key es pública;
 * RLS la contiene. ("Cliente" = cliente Supabase de infraestructura, no el
 * `cliente` del dominio = tenant.)
 */
export function createBrowserSupabaseClient() {
  return createBrowserClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
}
