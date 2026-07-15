import type { Database } from "@market-track/db";
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";

/**
 * Cliente Supabase atado a las cookies del request/response del middleware. El
 * `response` que devuelve arrastra las cookies de sesión refrescadas: hay que
 * devolverlo (o copiar sus cookies) para no perder el refresco del token.
 *
 * ("Cliente" = cliente Supabase de infraestructura, no el `cliente` del dominio.)
 */
export function createMiddlewareSupabaseClient(request: NextRequest) {
  const response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(
    env.SUPABASE_URL,
    env.SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );
  return { supabase, response };
}
