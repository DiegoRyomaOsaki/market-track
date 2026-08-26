import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { middleware } from "./middleware";

// La PUERTA del panel y el portal: qué se renderiza según quién llame.
//
// Estos tests existen por MAR-126. Antes solo se probaban las funciones puras de
// `lib/authz.ts` —que la REGLA de acceso es correcta— y no que el middleware la
// APLIQUE: son cosas distintas, y la que importa tras cerrar sesión es la
// segunda. Sin esto, "la ruta protegida deja de ser accesible" se quedaba en una
// comprobación manual.

const { getUser, getAal, perfil } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getAal: vi.fn(),
  perfil: vi.fn(),
}));

vi.mock("@/lib/supabase/middleware", () => ({
  createMiddlewareSupabaseClient: () => ({
    // `NextResponse.next()` viene del import de arriba: el middleware copia sus
    // cookies a la respuesta final, así que tiene que ser una de verdad.
    response: NextResponse.next(),
    supabase: {
      auth: {
        getUser,
        mfa: { getAuthenticatorAssuranceLevel: getAal },
      },
      // La cadena de PostgREST tal como la encadena el middleware. Doblarla así
      // —y no con un objeto laxo— hace que un cambio en esa cadena rompa el
      // test en vez de pasar de largo.
      from: () => ({
        select: () => ({
          eq: () => ({
            abortSignal: () => ({ single: perfil }),
          }),
        }),
      }),
    },
  }),
}));

function peticion(ruta: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000${ruta}`));
}

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "u1" } } });
  perfil.mockReset().mockResolvedValue({ data: { rol: "admin" }, error: null });
  getAal.mockReset().mockResolvedValue({
    data: { currentLevel: "aal2", nextLevel: "aal2" },
    error: null,
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("la puerta de las rutas protegidas", () => {
  it.each(["/admin", "/supervisor", "/cliente"])(
    "sin sesión, %s manda a /login",
    async (ruta) => {
      // La otra mitad de MAR-126: cerrar sesión borra las cookies, y esto es lo
      // que hace que la ruta protegida deje de servirse a partir de ese momento.
      getUser.mockResolvedValue({ data: { user: null } });

      const r = await middleware(peticion(ruta));

      expect(r.status).toBe(307);
      const destino = new URL(r.headers.get("location") ?? "");
      expect(destino.pathname).toBe("/login");
      // Y se recuerda a dónde iba, para devolverlo ahí tras volver a entrar.
      expect(destino.searchParams.get("redirect")).toBe(ruta);
    },
  );

  it("con sesión y rol que puede, deja pasar", async () => {
    // El control positivo: sin él, un middleware que redirigiera SIEMPRE pasaría
    // el test de arriba y nadie podría entrar al panel.
    const r = await middleware(peticion("/admin"));
    expect(r.status).not.toBe(307);
  });

  it("un rol que no toca esa sección recibe 403, no un rebote a /login", async () => {
    // La distinción importa: 307 a `/login` significaría "no has entrado" y le
    // pediría credenciales a alguien que ya las dio. 403 dice lo que pasa de
    // verdad — la sesión es válida y esa sección no es suya.
    perfil.mockResolvedValue({ data: { rol: "cliente" }, error: null });
    const r = await middleware(peticion("/admin"));
    expect(r.status).toBe(403);
  });

  it("si el Auth server se cae, cierra la puerta en vez de abrirla", async () => {
    // Fail-closed: un throw sin manejar rompería cada navegación, y dejar pasar
    // durante una caída convertiría un incidente de disponibilidad en uno de
    // acceso.
    getUser.mockRejectedValue(new Error("auth caído"));
    const r = await middleware(peticion("/supervisor"));
    expect(r.status).toBe(307);
    expect(new URL(r.headers.get("location") ?? "").pathname).toBe("/login");
  });

  it("con el segundo factor pendiente manda a /login?paso=2fa", async () => {
    getAal.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    });
    const r = await middleware(peticion("/admin"));
    const destino = new URL(r.headers.get("location") ?? "");
    expect(destino.searchParams.get("paso")).toBe("2fa");
  });
});
