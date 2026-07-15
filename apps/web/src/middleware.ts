import type { RolUsuario } from "@market-track/shared";
import { type NextRequest, NextResponse } from "next/server";

import { puedeAccederA, segmentoDeRuta } from "@/lib/authz";
import { createMiddlewareSupabaseClient } from "@/lib/supabase/middleware";

// El middleware es la PUERTA (qué sección se renderiza), no la seguridad: la
// autorización real la impone RLS en cada consulta. Aquí solo se enruta por rol.
const AUTH_TIMEOUT_MS = 8_000;

/** Carrera contra un deadline: una llamada colgada no bloquea cada navegación. */
function conDeadline<T>(promesa: PromiseLike<T>, ms: number): Promise<T> {
  return Promise.race([
    Promise.resolve(promesa),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout tras ${ms}ms`)), ms),
    ),
  ]);
}

export async function middleware(request: NextRequest) {
  const segmento = segmentoDeRuta(request.nextUrl.pathname);
  // El matcher ya acota a los tres segmentos; fuera de ellos, no tocar.
  if (!segmento) return NextResponse.next();

  const { supabase, response } = createMiddlewareSupabaseClient(request);

  // Propaga a `destino` las cookies (posiblemente refrescadas) que Supabase
  // escribió en `response`. Sin esto, un redirect/403 descarta el token rotado y
  // desloguea al usuario en su siguiente petición.
  const conCookies = (destino: NextResponse): NextResponse => {
    for (const cookie of response.cookies.getAll()) destino.cookies.set(cookie);
    return destino;
  };

  const redirigirALogin = (): NextResponse => {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", request.nextUrl.pathname);
    return conCookies(NextResponse.redirect(url));
  };

  try {
    // getUser revalida contra el Auth server (no confía en la cookie a ciegas).
    const {
      data: { user },
    } = await conDeadline(supabase.auth.getUser(), AUTH_TIMEOUT_MS);
    if (!user) return redirigirALogin();

    // El rol se lee EN VIVO de `profile` (RLS: cada quien lee su propia fila). No
    // se copia al JWT —sería una copia rancia— ni se recalcula el acceso aquí: la
    // revocación (usuario/cliente dado de baja) la impone RLS sobre los DATOS.
    const { data: perfil, error } = await supabase
      .from("profile")
      .select("rol")
      .eq("id", user.id)
      .abortSignal(AbortSignal.timeout(AUTH_TIMEOUT_MS))
      .single();

    const rol: RolUsuario | null = error ? null : perfil.rol;
    if (!puedeAccederA(rol, segmento)) {
      console.warn(
        JSON.stringify({
          evento: "acceso_denegado",
          user_id: user.id,
          rol: rol ?? "ilegible",
          segmento,
          detalle: error ? error.message.slice(0, 200) : undefined,
        }),
      );
      return conCookies(new NextResponse("Forbidden", { status: 403 }));
    }

    // Punto de extensión del 2FA: aquí va el gate de `aal2` sobre esta MISMA
    // sesión cuando aterrice el segundo factor server-side, sin abrir otro camino
    // de enforcement (ADR-0008).

    return response;
  } catch (err) {
    // Timeout / caída del Auth server / red: fail-closed a login, no un throw sin
    // manejar que rompa cada navegación durante una caída de Supabase.
    console.error(
      JSON.stringify({
        evento: "middleware_error",
        segmento,
        detalle: err instanceof Error ? err.message.slice(0, 200) : String(err),
      }),
    );
    return redirigirALogin();
  }
}

export const config = {
  matcher: ["/admin/:path*", "/supervisor/:path*", "/cliente/:path*"],
};
