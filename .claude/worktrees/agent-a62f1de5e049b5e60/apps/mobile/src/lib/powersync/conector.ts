import {
  type AbstractPowerSyncDatabase,
  type CrudEntry,
  type PowerSyncBackendConnector,
  UpdateType,
} from "@powersync/react-native";

import { env } from "@/lib/env";
import { supabase } from "@/lib/supabase";
import { mensajeDeError } from "../error";

// El puente entre la réplica local y el backend (ADR-0001).
//
// Asimetría clave:
//   - BAJADA: la decide el servicio PowerSync con las sync rules (BYPASSRLS). El
//     conector solo le da el token; el filtrado es de packages/sync.
//   - SUBIDA: se reenvía por el cliente de Supabase (PostgREST), y ahí la RLS SÍ
//     manda. Una escritura de otro tenant la rechaza la RLS, no esto.

export class ConectorSupabase implements PowerSyncBackendConnector {
  /** El endpoint del servicio PowerSync y el JWT de la sesión actual. */
  async fetchCredentials() {
    if (!env.POWERSYNC_URL) return null; // sin endpoint configurado, no se sincroniza
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null; // sin sesión no se sincroniza
    return { endpoint: env.POWERSYNC_URL, token };
  }

  /**
   * Sube la cola local al backend. Toma la siguiente transacción (agrupa las ops
   * de un mismo commit) y reenvía cada op por PostgREST.
   *
   * El manejo de error distingue dos causas, porque tratarlas igual rompe la
   * cola:
   *   - Rechazo PERMANENTE (la RLS o un constraint dijeron que no): reintentar
   *     no lo va a cambiar. Se descarta esa op y se sigue, para que una sola op
   *     envenenada no bloquee para siempre todo lo que tiene detrás. Se registra
   *     para que no desaparezca en silencio.
   *   - Fallo TRANSITORIO (red caída, servicio no disponible): se relanza sin
   *     completar la transacción; PowerSync reintenta el mismo lote —de ahí que
   *     el backend deba ser idempotente (upsert por id)— y no se pierde nada.
   */
  async uploadData(base: AbstractPowerSyncDatabase) {
    const tx = await base.getNextCrudTransaction();
    if (!tx) return;

    for (const op of tx.crud) {
      try {
        await this.aplicarOperacion(op);
      } catch (error) {
        if (esRechazoPermanente(error)) {
          console.error(mensajeRechazo(op, error));
          continue; // se descarta la op envenenada; la cola sigue
        }
        throw error; // transitorio: PowerSync reintenta el lote entero
      }
    }

    await tx.complete();
  }

  /** Reenvía una operación CRUD por PostgREST. Lanza si el backend la rechaza. */
  private async aplicarOperacion(op: CrudEntry) {
    const tabla = supabase.from(op.table);
    switch (op.op) {
      case UpdateType.PUT: {
        const { error } = await tabla.upsert({ ...op.opData, id: op.id });
        if (error) throw error;
        return;
      }
      case UpdateType.PATCH: {
        const { error } = await tabla.update(op.opData ?? {}).eq("id", op.id);
        if (error) throw error;
        return;
      }
      case UpdateType.DELETE: {
        const { error } = await tabla.delete().eq("id", op.id);
        if (error) throw error;
        return;
      }
      default: {
        // Si PowerSync añade un UpdateType, esto no compila hasta manejarlo:
        // más vale un error de tipos que una op perdida en silencio.
        const noManejado: never = op.op;
        throw new Error(`UpdateType no soportado: ${String(noManejado)}`);
      }
    }
  }
}

/**
 * ¿El error es un rechazo permanente del backend? Un error de PostgREST trae un
 * `code` (el SQLSTATE de Postgres: 42501 permiso denegado, 23505 duplicado,
 * 23503 llave foránea…): el servidor lo procesó y lo rechazó, reintentar no
 * cambia nada. Un fallo de red no trae SQLSTATE, así que se trata como
 * transitorio y se reintenta.
 */
function esRechazoPermanente(error: unknown): boolean {
  const code = codigoSqlstate(error);
  return code !== null && code.length > 0;
}

/** El SQLSTATE de un error de PostgREST, o null si el error no lo trae. */
function codigoSqlstate(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  return typeof error.code === "string" ? error.code : null;
}

/** Mensaje de log para una op descartada, sin volcar `opData` ni secretos. */
function mensajeRechazo(op: CrudEntry, error: unknown): string {
  const code = codigoSqlstate(error) ?? "?";
  const detalle = mensajeDeError(error);
  return `Op de sync descartada (${op.op} ${op.table} ${op.id}): ${code} ${detalle.slice(0, 200)}`;
}
