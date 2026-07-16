import type { RolUsuario } from "@market-track/shared";
import { type NextRequest, NextResponse } from "next/server";

import {
  puedeAccederA,
  requiereSegundoFactor,
  segmentoDeRuta,
} from "@/lib/authz";
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

  const redirigirALogin = (paso?: "2fa"): NextResponse => {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", request.nextUrl.pathname);
    if (paso) url.searchParams.set("paso", paso);
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

    // Gate del segundo factor (ADR-0008). El enforcement es el claim NATIVO `aal`
    // sobre esta MISMA sesión — no un segundo camino. Si el usuario tiene un factor
    // verificado (`nextLevel: aal2`) pero su sesión sigue en `aal1`, no completó el
    // 2FA y no pasa.
    //
    // Un usuario SIN factor sí pasa este gate, a propósito: exigir aquí un factor
    // que todavía no existe dejaría fuera a todo el mundo. Forzar el ENROLAMIENTO
    // es trabajo del login; entre los dos, el 2FA queda obligatorio.
    // Acotada como las demás: sin argumento resuelve la sesión y puede disparar un
    // refresh de red — y una promesa colgada no la rescata el catch de abajo.
    const { data: aal, error: errAal } = await conDeadline(
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      AUTH_TIMEOUT_MS,
    );
    if (errAal || !aal) {
      console.error(
        JSON.stringify({
          evento: "aal_ilegible",
          user_id: user.id,
          detalle: errAal ? errAal.message.slice(0, 200) : "sin datos",
        }),
      );
      return redirigirALogin(); // fail-closed
    }
    if (requiereSegundoFactor(aal.currentLevel, aal.nextLevel)) {
      console.warn(
        JSON.stringify({
          evento: "segundo_factor_pendiente",
          user_id: user.id,
          segmento,
        }),
      );
      return redirigirALogin("2fa");
    }

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
