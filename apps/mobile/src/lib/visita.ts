import type { PuntoGeo } from "@market-track/shared";
import * as Crypto from "expo-crypto";

import { puntoAEwkt } from "./geo";
import { db } from "./powersync/db";

// La escritura del check-in en la réplica LOCAL. PowerSync la encola y la sube por
// el conector (ADR-0001); nunca se llama a la red aquí.
//
// `tenant_id` lo pone el cliente (la columna es `not null` sin default, y la FK
// compuesta exige que coincida con el de la tienda/parada): sale de la parada, que
// el móvil ya tiene en la réplica. `check_in_geo` va en EWKT; el servidor re-valida
// la geocerca (MAR-30) y sella la hora autoritativa.

export type DatosCheckIn = {
  tenant_id: string;
  rutero_parada_id: string;
  tienda_id: string;
  mercaderista_id: string;
  punto: PuntoGeo;
  capturado_at: string;
  selfie_foto_id: string | null;
};

/** Crea la visita del check-in y devuelve su id. */
export async function crearVisitaCheckIn(d: DatosCheckIn): Promise<string> {
  const id = Crypto.randomUUID();
  await db.execute(
    `INSERT INTO visita
       (id, tenant_id, rutero_parada_id, tienda_id, mercaderista_id,
        check_in_at, check_in_geo, estado, selfie_foto_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'en_curso', ?)`,
    [
      id,
      d.tenant_id,
      d.rutero_parada_id,
      d.tienda_id,
      d.mercaderista_id,
      d.capturado_at,
      puntoAEwkt(d.punto),
      d.selfie_foto_id,
    ],
  );
  return id;
}
