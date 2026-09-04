import type { RolUsuario } from "@market-track/shared";

// Los segmentos de ruta del sitio con control por rol.
export const SEGMENTOS = ["admin", "supervisor", "cliente"] as const;
export type Segmento = (typeof SEGMENTOS)[number];

// Qué segmentos ve cada rol. Record EXHAUSTIVO por rol: si una migración añade un
// rol, este objeto deja de compilar (no un `default` que lo trague en silencio).
// El admin es staff global y puede cambiar de contexto a la vista de supervisor
// (role switch del header); el supervisor solo ve lo suyo.
const SEGMENTOS_POR_ROL: Record<RolUsuario, ReadonlyArray<Segmento>> = {
  admin: ["admin", "supervisor"],
  supervisor: ["supervisor"],
  cliente: ["cliente"],
  // El mercaderista trabaja en la app móvil: no entra a ninguna sección web.
  mercaderista: [],
};

/** ¿Puede este rol entrar al segmento? `null` (sin sesión / rol ilegible) deniega todo. */
export function puedeAccederA(
  rol: RolUsuario | null,
  segmento: Segmento,
): boolean {
  if (rol === null) return false;
  return SEGMENTOS_POR_ROL[rol].includes(segmento);
}

/**
 * ¿La sesión tiene el segundo factor PENDIENTE? (ADR-0008)
 *
 * Se lee del `aal` nativo: `nextLevel` sube a `aal2` solo si el usuario tiene un
 * factor verificado. Si lo tiene y su sesión sigue en `aal1`, no completó el 2FA.
 * Quien NO tiene factor (`nextLevel: aal1`) no lo tiene pendiente — forzar el
 * enrolamiento es trabajo del login, no de este gate.
 */
export function requiereSegundoFactor(
  currentLevel: string | null,
  nextLevel: string | null,
): boolean {
  return nextLevel === "aal2" && currentLevel !== "aal2";
}

// Un origen reservado (TLD `.invalid`, no resuelve nunca) contra el que probar a
// resolver el destino.
const ORIGEN_DE_PRUEBA = "http://interno.invalid";

/**
 * Solo rutas internas. El `redirect` del query lo pone quien arma el enlace, así
 * que no puede usarse tal cual para navegar.
 *
 * No basta con mirar el prefijo: `/\otro.com` empieza por UNA barra y parece
 * interno, pero el parser de URL del navegador convierte `\` en `/` y acaba
 * resolviéndolo a `https://otro.com`. Por eso se RESUELVE igual que lo haría el
 * navegador y se comprueba que (a) no cambió de origen y (b) sigue siendo la
 * misma cadena. Lo que no reproduzca su propia ruta, no se usa.
 */
export function rutaSegura(
  destino: string | undefined,
  porDefecto = "/",
): string {
  if (!destino) return porDefecto;
  try {
    const url = new URL(destino, ORIGEN_DE_PRUEBA);
    if (url.origin !== ORIGEN_DE_PRUEBA) return porDefecto;
    const ruta = `${url.pathname}${url.search}${url.hash}`;
    return ruta === destino ? ruta : porDefecto;
  } catch {
    return porDefecto;
  }
}

function esSegmento(valor: string): valor is Segmento {
  return (SEGMENTOS as readonly string[]).includes(valor);
}

/** El primer tramo de la ruta, si es uno de los segmentos controlados; si no, null. */
export function segmentoDeRuta(pathname: string): Segmento | null {
  const primero = pathname.split("/")[1] ?? "";
  return esSegmento(primero) ? primero : null;
}
