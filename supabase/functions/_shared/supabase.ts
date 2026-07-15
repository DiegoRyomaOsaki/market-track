// Clientes de Supabase para las Edge Functions (Deno). Dos, y la diferencia
// importa:
//
//   clienteServicio()   — usa SERVICE_ROLE_KEY: SALTA RLS. Solo para lo que el
//                         servidor debe hacer con autoridad (crear usuarios,
//                         escribir alertas). Nunca se expone al cliente.
//   clienteDelLlamante() — usa el JWT de quien llama: corre CON su RLS. Sirve
//                         para saber QUIÉN llama y con qué permisos.
//
// SUPABASE_URL / SERVICE_ROLE_KEY / ANON_KEY los inyecta Supabase en la función,
// tanto en local como en la nube — no van en el .env.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const sinSesion = { auth: { autoRefreshToken: false, persistSession: false } };

export function clienteServicio(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    sinSesion,
  );
}

export function clienteDelLlamante(req: Request): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      ...sinSesion,
      global: {
        headers: { Authorization: req.headers.get("Authorization") ?? "" },
      },
    },
  );
}

/** Respuesta JSON con los headers CORS mínimos. */
export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
