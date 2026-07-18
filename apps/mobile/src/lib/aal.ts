// El nivel de aseguramiento (aal) de la sesión, leído del claim del JWT.
//
// Importa de verdad: una sesión de solo contraseña es `aal1`, y con aal1 la RLS
// no deja leer datos (ADR-0008). La app NO debe dejar entrar una sesión aal1 —
// tiene que quedarse en el login hasta completar el segundo factor.

function decodificarPayload(accessToken: string): unknown {
  const parte = accessToken.split(".")[1];
  if (!parte) return null;
  const b64 = parte.replace(/-/g, "+").replace(/_/g, "/");
  const conRelleno = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
  return JSON.parse(atob(conRelleno));
}

/** El claim `aal` del token, o null si no se puede leer. */
export function aalDeToken(
  accessToken: string | undefined | null,
): string | null {
  if (!accessToken) return null;
  try {
    const payload = decodificarPayload(accessToken);
    if (payload && typeof payload === "object" && "aal" in payload) {
      const { aal } = payload;
      return typeof aal === "string" ? aal : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** ¿La sesión completó el segundo factor? Solo aal2 entra a la app. */
export function esAal2(accessToken: string | undefined | null): boolean {
  return aalDeToken(accessToken) === "aal2";
}
