// Los topics de los feeds en vivo (tablero del supervisor, feed del portal).
//
// Espejo en TypeScript de `app.topico_tenant()` / `app.topico_staff()`
// (migración `20260803230000_realtime_feeds_en_vivo.sql`). La base decide quién
// puede unirse a cada canal; aquí solo se construye el nombre. Si las dos
// cadenas dejan de coincidir el síntoma es "no llega nada", así que
// `packages/db/test/realtime.db.test.ts` las compara contra la base.
//
// Los canales son PRIVADOS: hay que abrirlos con `{ config: { private: true } }`
// y haber llamado antes a `supabase.realtime.setAuth()`, o Realtime no evalúa
// las políticas y el join se rechaza.

// Las tablas que se transmiten en vivo. El nombre del feed ES el de la tabla.
//
// `solicitud_cambio_ruta` solo tiene canal de staff: es un asunto interno entre
// el mercaderista y su supervisor, y la política de `realtime.messages` no deja
// al cliente-marca unirse a su topic de tenant.
export const FEEDS_EN_VIVO = [
  "alerta",
  "visita",
  "solicitud_cambio_ruta",
] as const;

export type FeedEnVivo = (typeof FEEDS_EN_VIVO)[number];

/** Canal del cliente-marca: solo lo de su tenant. */
export function topicoTenant(tenantId: string, feed: FeedEnVivo): string {
  return `tenant:${tenantId}:${feed}`;
}

/** Canal del personal de la outsourcing: la operación de todos los clientes. */
export function topicoStaff(feed: FeedEnVivo): string {
  return `staff:${feed}`;
}
