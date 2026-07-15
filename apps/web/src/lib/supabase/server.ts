import type { Database } from "@market-track/db";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { env } from "@/lib/env";

/**
 * Cliente Supabase para Server Components / Route Handlers. Corre CON el JWT del
 * usuario (vía cookies), así que sus consultas pasan por RLS — que es la
 * seguridad real. Tipado con `Database` (fuente única de las filas).
 */
export async function crearClienteServidor() {
  const cookieStore = await cookies();
  return createServerClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Un Server Component no puede escribir cookies. El middleware ya
          // refresca la sesión, así que ignorarlo aquí es seguro (patrón
          // oficial de @supabase/ssr).
        }
      },
    },
  });
}
