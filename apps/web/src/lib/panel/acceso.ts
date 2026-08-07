import type { CanalOtp, EstadoPase } from "@market-track/shared";

// La pantalla de acceso y segundo factor: cómo se lee un pase y qué se puede
// hacer con él. Fuera de la UI para poder probarlo.

/**
 * El canje del pase todavía no existe (MAR-66): hoy se emite un código que aún
 * no permite iniciar sesión.
 *
 * Callarlo convertiría la pantalla en una promesa falsa y al operador en el que
 * lo descubre por teléfono, con el mercaderista esperando al otro lado. Vive en
 * una constante para que el ticket que lo implemente lo borre de un solo sitio.
 */
export const AVISO_CANJE_PENDIENTE =
  "El canje todavía no está disponible en la app: el código se emite y queda auditado, pero aún no permite iniciar sesión.";

/**
 * SMS y WhatsApp aún no entregan.
 *
 * Verificado: la función de envío devuelve 501 para todo lo que no sea correo, y
 * ningún usuario puede elegir canal todavía. Habilitarlos no rompe nada, pero
 * tampoco entrega — y decir otra cosa sería documentar lo planeado como si fuera
 * lo actual.
 */
export const AVISO_CANALES_SIN_ENTREGA =
  "SMS y WhatsApp todavía no entregan: falta conectar el proveedor de mensajería. Habilitarlos aquí guarda la política, pero por ahora todos los códigos salen por correo.";

export const ETIQUETA_CANAL: Record<CanalOtp, string> = {
  correo: "Correo electrónico",
  sms: "SMS",
  whatsapp: "WhatsApp",
};

export const ETIQUETA_ESTADO_PASE: Record<EstadoPase, string> = {
  vigente: "Vigente",
  usado: "Usado",
  vencido: "Vencido",
  revocado: "Revocado",
};

// El texto va SIEMPRE dentro de la pastilla: el color acompaña, no informa
// (WCAG 1.4.1).
export const ESTILO_ESTADO_PASE: Record<EstadoPase, string> = {
  vigente: "bg-en-curso-suave text-en-curso-texto",
  usado: "bg-completado-suave text-completado-texto",
  vencido: "bg-muted text-muted-foreground",
  revocado: "bg-alerta-suave text-alerta-texto",
};

/** El correo no se puede quitar: es el único canal que entrega. */
export const CANAL_OBLIGATORIO: CanalOtp = "correo";

/**
 * Normaliza la lista de canales elegidos.
 *
 * El correo entra siempre, aunque no venga marcado. La regla de verdad es el
 * CHECK de la base; esto ahorra el viaje y da un mensaje mejor, pero no es lo
 * que la impone.
 */
export function canalesConCorreo(elegidos: readonly CanalOtp[]): CanalOtp[] {
  const unicos = new Set<CanalOtp>(elegidos);
  unicos.add(CANAL_OBLIGATORIO);
  // Orden estable: dos guardados con los mismos canales producen el mismo array.
  return (["correo", "sms", "whatsapp"] as const).filter((c) => unicos.has(c));
}

/**
 * Lo que queda de un pase, en mm:ss.
 *
 * Se calcula contra `expira_at` y no decrementando un contador: una pestaña en
 * segundo plano deja de recibir ticks y el contador se desviaría del reloj real.
 */
export function tiempoRestante(expiraAt: string, ahora: Date): string {
  const restanMs = new Date(expiraAt).getTime() - ahora.getTime();
  if (!Number.isFinite(restanMs) || restanMs <= 0) return "00:00";

  const totalSeg = Math.floor(restanMs / 1000);
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  return `${String(min).padStart(2, "0")}:${String(seg).padStart(2, "0")}`;
}

/** ¿Sigue vivo? Lo decide el reloj, no el estado que se pintó hace un minuto. */
export function sigueVigente(expiraAt: string, ahora: Date): boolean {
  return new Date(expiraAt).getTime() > ahora.getTime();
}

/**
 * Solo se revoca lo que está vigente.
 *
 * Un pase usado ya sirvió y revocarlo diría que nunca se usó; uno vencido ya no
 * da acceso. La base lo impone con un trigger — esto solo evita ofrecer un botón
 * que iba a fallar.
 */
export function sePuedeRevocar(estado: EstadoPase): boolean {
  return estado === "vigente";
}
