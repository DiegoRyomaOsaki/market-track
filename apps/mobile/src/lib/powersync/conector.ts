import {
  type AbstractPowerSyncDatabase,
  type PowerSyncBackendConnector,
  UpdateType,
} from "@powersync/react-native";

import { env } from "@/lib/env";
import { supabase } from "@/lib/supabase";

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
   * de un mismo commit), la reenvía por PostgREST y la marca completa. Si algo
   * falla se lanza: PowerSync reintenta el mismo lote —de ahí que el backend deba
   * ser idempotente (upsert por id)— y no se pierde nada.
   */
  async uploadData(base: AbstractPowerSyncDatabase) {
    const tx = await base.getNextCrudTransaction();
    if (!tx) return;

    for (const op of tx.crud) {
      const tabla = supabase.from(op.table);
      if (op.op === UpdateType.PUT) {
        const { error } = await tabla.upsert({ ...op.opData, id: op.id });
        if (error) throw error;
      } else if (op.op === UpdateType.PATCH) {
        const { error } = await tabla.update(op.opData ?? {}).eq("id", op.id);
        if (error) throw error;
      } else if (op.op === UpdateType.DELETE) {
        const { error } = await tabla.delete().eq("id", op.id);
        if (error) throw error;
      }
    }

    await tx.complete();
  }
}
