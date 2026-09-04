import * as Crypto from "expo-crypto";

import { db } from "./powersync/db";
import { type TipoSolicitud } from "./solicitud-ruta";

// La escritura de una solicitud de cambio de ruta, aparte de las reglas/lecturas
// (solicitud-ruta.ts) porque toca `db` (motor nativo). Offline-first: escribe en
// la réplica local y PowerSync la sube por la cola; nunca hay red directa.

export async function crearSolicitud(d: {
  tenant_id: string;
  mercaderista_id: string;
  tipo: TipoSolicitud;
  motivo: string;
}): Promise<void> {
  await db.execute(
    `INSERT INTO solicitud_cambio_ruta
       (id, tenant_id, mercaderista_id, tipo, motivo, estado, creada_at)
     VALUES (?, ?, ?, ?, ?, 'nueva', ?)`,
    [
      Crypto.randomUUID(),
      d.tenant_id,
      d.mercaderista_id,
      d.tipo,
      d.motivo.trim(),
      new Date().toISOString(),
    ],
  );
}
