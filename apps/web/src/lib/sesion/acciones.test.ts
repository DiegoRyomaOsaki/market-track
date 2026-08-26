import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cerrarSesion } from "./acciones";

// El cierre de sesión del panel y del portal. Una Server Action es un endpoint
// POST alcanzable, así que lo que se prueba aquí no es "el botón funciona": es
// que ninguna rama pueda terminar dejando la sesión viva.
//
// `next/navigation` NO se dobla: `redirect()` lanza una excepción con un
// `digest` que es contrato público de Next, y afirmar sobre él prueba a la vez
// el destino y el TIPO de redirección. Doblarlo probaría el doble.

const { cookieStore, signOut, getSession } = vi.hoisted(() => ({
  cookieStore: {
    getAll: vi.fn(() => [] as { name: string }[]),
    delete: vi.fn(),
  },
  signOut: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve(cookieStore),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () =>
    Promise.resolve({ auth: { signOut, getSession } }),
}));

/** El `digest` que lanza `redirect()`, o "" si la llamada no redirigió. */
async function digestDe(datos: unknown): Promise<string> {
  try {
    await cerrarSesion(datos);
    return "";
  } catch (error) {
    return (error as { digest?: string }).digest ?? "";
  }
}

beforeEach(() => {
  cookieStore.getAll.mockReturnValue([]);
  cookieStore.delete.mockReset();
  signOut.mockReset().mockResolvedValue({ error: null });
  getSession.mockReset().mockResolvedValue({
    data: { session: { user: { id: "u1" } } },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("cerrarSesion", () => {
  it("cierra la sesión de TODOS los dispositivos, no solo de este navegador", async () => {
    // Contrato de seguridad, no preferencia: con `local` el portátil prestado o
    // robado se quedaría abierto, que es el caso que motiva todo esto.
    await digestDe(new FormData());
    expect(signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("manda a /login REEMPLAZANDO la entrada del historial", async () => {
    // `replace` y no el `push` por defecto: sustituye la pantalla de la que se
    // sale, así que el "atrás" inmediato ya no apunta a la ruta protegida.
    expect(await digestDe(new FormData())).toBe(
      "NEXT_REDIRECT;replace;/login;307;",
    );
  });

  it("si el proveedor de auth falla, borra las cookies de sesión igual", async () => {
    // Cuando `signOut` no logra resolver la sesión local, auth-js devuelve el
    // error y NO la borra. Sin este respaldo eso es un "Salir" que deja la
    // sesión viva, y en silencio.
    const aviso = vi.spyOn(console, "error").mockImplementation(() => {});
    signOut.mockResolvedValue({ error: { message: "auth caído" } });
    cookieStore.getAll.mockReturnValue([
      { name: "sb-127-auth-token" },
      { name: "sb-127-auth-token.1" },
      { name: "otra-cosa" },
    ]);

    expect(await digestDe(new FormData())).toContain("/login");

    expect(cookieStore.delete).toHaveBeenCalledWith("sb-127-auth-token");
    expect(cookieStore.delete).toHaveBeenCalledWith("sb-127-auth-token.1");
    expect(cookieStore.delete).not.toHaveBeenCalledWith("otra-cosa");
    expect(aviso).toHaveBeenCalled();
  });

  it("si el proveedor se cuelga, corta al deadline en vez de bloquear la salida", async () => {
    // El SDK no admite `AbortSignal` en `signOut` y su default de red pasa de
    // los 30 s: sin techo, el usuario se queda mirando un botón que no responde.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    signOut.mockReturnValue(new Promise(() => {}));
    cookieStore.getAll.mockReturnValue([{ name: "sb-127-auth-token" }]);

    const enCurso = digestDe(new FormData());
    await vi.advanceTimersByTimeAsync(8_000);

    expect(await enCurso).toContain("/login");
    expect(cookieStore.delete).toHaveBeenCalledWith("sb-127-auth-token");
  });

  it("un cuerpo que no es un envío de formulario no toca la sesión", async () => {
    expect(await digestDe("hola")).toContain("/login");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("olvida el cliente-marca que estaba mirando el anterior", async () => {
    // El portátil compartido es el escenario del ticket: encontrarse la vista de
    // otro al entrar es desconcertante, aunque la RLS acote por perfil.
    await digestDe(new FormData());
    expect(cookieStore.delete).toHaveBeenCalledWith("mt_tenant");
  });

  it("no registra ningún token, solo quién salió", async () => {
    const traza = vi.spyOn(console, "info").mockImplementation(() => {});
    await digestDe(new FormData());
    const linea = String(traza.mock.calls[0]?.[0] ?? "");
    expect(linea).toContain("u1");
    expect(linea).not.toMatch(/token|jwt|bearer/i);
  });
});

describe("cerrarSesion — el rechazo que no es un Error", () => {
  it("un rechazo con un valor cualquiera se registra igual y borra las cookies", async () => {
    // Un SDK puede rechazar con un string o un objeto plano. Si esa rama
    // reventara al construir el mensaje, el "Salir" fallaría con la sesión viva.
    const aviso = vi.spyOn(console, "error").mockImplementation(() => {});
    signOut.mockRejectedValue("boom");
    cookieStore.getAll.mockReturnValue([{ name: "sb-127-auth-token" }]);

    expect(await digestDe(new FormData())).toContain("/login");

    expect(cookieStore.delete).toHaveBeenCalledWith("sb-127-auth-token");
    expect(String(aviso.mock.calls[0]?.[0] ?? "")).toContain("boom");
  });
});
