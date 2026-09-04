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
  // Minutos de traslado desde la tienda anterior (modo tránsito). Null si es la
  // primera visita del día o no venía un cronómetro en curso.
  tiempo_traslado_min: number | null;
  // La versión del formulario de check-in que se le MOSTRÓ (MAR-98). Se resuelve
  // al renderizar, no al confirmar: lo que vio es lo que queda anclado. Null si
  // el cliente no tiene checklist configurado.
  formulario_version_id: string | null;
};

/** Crea la visita del check-in y devuelve su id. */
export async function crearVisitaCheckIn(d: DatosCheckIn): Promise<string> {
  const id = Crypto.randomUUID();
  await db.execute(
    `INSERT INTO visita
       (id, tenant_id, rutero_parada_id, tienda_id, mercaderista_id,
        check_in_at, check_in_geo, estado, selfie_foto_id, tiempo_traslado_min,
        formulario_version_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'en_curso', ?, ?, ?)`,
    [
      id,
      d.tenant_id,
      d.rutero_parada_id,
      d.tienda_id,
      d.mercaderista_id,
      d.capturado_at,
      puntoAEwkt(d.punto),
      d.selfie_foto_id,
      d.tiempo_traslado_min,
      d.formulario_version_id,
    ],
  );
  return id;
}

/**
 * Guarda las respuestas del checklist de check-in (una fila por campo
 * contestado). Réplica local; PowerSync las sube por el CRUD. Quien llama ya
 * encoló las fotos: la fila `foto` tiene que viajar antes que la respuesta que
 * la referencia por uuid.
 */
export async function guardarRespuestasVisita(d: {
  visita_id: string;
  tenant_id: string;
  respuestas: { campo_id: string; valor: unknown }[];
}): Promise<void> {
  for (const r of d.respuestas) {
    await db.execute(
      `INSERT INTO visita_respuesta (id, tenant_id, visita_id, campo_id, valor)
       VALUES (?, ?, ?, ?, ?)`,
      [
        Crypto.randomUUID(),
        d.tenant_id,
        d.visita_id,
        r.campo_id,
        JSON.stringify(r.valor),
      ],
    );
  }
}

/**
 * Cierra la visita con el check-out. `estado = 'completada'`; el servidor
 * re-valida la geocerca de salida y sella la hora autoritativa (MAR-30). No
 * espera a que suban las fotos: la cola a R2 sigue su curso aparte.
 */
export async function cerrarVisitaCheckOut(d: {
  visita_id: string;
  punto: PuntoGeo;
  capturado_at: string;
  bitacora: string | null;
}): Promise<void> {
  await db.execute(
    `UPDATE visita
        SET check_out_at = ?, check_out_geo = ?, estado = 'completada',
            bitacora = ?
      WHERE id = ?`,
    [d.capturado_at, puntoAEwkt(d.punto), d.bitacora, d.visita_id],
  );
}
