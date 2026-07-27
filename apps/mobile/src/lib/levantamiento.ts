import type { PasoLevantamiento } from "@market-track/shared";
import { useQuery } from "@powersync/react-native";
import * as Crypto from "expo-crypto";

import { db } from "./powersync/db";
import { type FrenteCompetidor } from "./share-of-shelf";

// La lectura y escritura del levantamiento por marca, sobre la réplica local
// (ADR-0001). Igual que la visita, `tenant_id` lo pone el cliente (columna
// not-null sin default; sale de la visita/parada que la app ya tiene local).

export type ContextoVisita = {
  tenant_id: string;
  tienda_id: string;
  estado: string;
};

/** El tenant y la tienda de una visita — lo que el levantamiento necesita para
 * crearse (`tenant_id` es not-null sin default: lo pone el cliente). */
export function useVisita(visitaId: string) {
  const { data, isLoading } = useQuery<ContextoVisita>(
    `SELECT tenant_id, tienda_id, estado FROM visita WHERE id = ?`,
    [visitaId],
  );
  return { visita: data?.[0] ?? null, cargando: isLoading };
}

export type MarcaAuditable = {
  id: string;
  nombre: string;
  logo_url: string | null;
  levantamiento_id: string | null;
  levantamiento_estado: string | null;
};

/**
 * Las marcas a auditar en una visita: las que tienen SKU codificados en la
 * tienda (derivadas de `tienda_sku`, sin tabla extra). La tienda sale de la
 * propia visita. En el piloto es una sola marca y el selector se salta.
 */
export function useMarcasDeVisita(visitaId: string) {
  const { data, isLoading } = useQuery<MarcaAuditable>(
    `SELECT DISTINCT m.id AS id, m.nombre AS nombre, m.logo_url AS logo_url,
            l.id AS levantamiento_id, l.estado AS levantamiento_estado
     FROM visita v
     JOIN tienda_sku ts ON ts.tienda_id = v.tienda_id AND ts.activo = 1
     JOIN sku s ON s.id = ts.sku_id
     JOIN marca m ON m.id = s.marca_id AND m.activo = 1
     LEFT JOIN levantamiento l ON l.marca_id = m.id AND l.visita_id = v.id
     WHERE v.id = ?
     ORDER BY m.nombre`,
    [visitaId],
  );
  return { marcas: data ?? [], cargando: isLoading };
}

export type ContingenciaLocal = { paso: string; motivo: string };

/** Las contingencias ya registradas en un levantamiento (pasos "⚠ Omitido"). */
export function useContingencias(levantamientoId: string | null) {
  const { data } = useQuery<ContingenciaLocal>(
    `SELECT paso, motivo FROM contingencia WHERE levantamiento_id = ?`,
    [levantamientoId ?? ""],
  );
  return data ?? [];
}

/** Crea el levantamiento de una marca en una visita y devuelve su id. */
export async function crearLevantamiento(d: {
  tenant_id: string;
  visita_id: string;
  marca_id: string;
}): Promise<string> {
  const id = Crypto.randomUUID();
  await db.execute(
    `INSERT INTO levantamiento (id, tenant_id, visita_id, marca_id, estado)
     VALUES (?, ?, ?, ?, 'en_curso')`,
    [id, d.tenant_id, d.visita_id, d.marca_id],
  );
  return id;
}

export async function completarLevantamiento(id: string): Promise<void> {
  await db.execute(`UPDATE levantamiento SET estado = 'completado' WHERE id = ?`, [
    id,
  ]);
}

export type LevantamientoRow = {
  foto_antes_id: string | null;
  foto_despues_id: string | null;
  sos_frentes_propios: number | null;
  sos_frentes_competencia: string | null;
  sos_foto_id: string | null;
  estado: string;
};

/** El levantamiento en curso, para hidratar los pasos con lo ya capturado. */
export function useLevantamiento(id: string | null) {
  const { data } = useQuery<LevantamientoRow>(
    `SELECT foto_antes_id, foto_despues_id, sos_frentes_propios,
            sos_frentes_competencia, sos_foto_id, estado
     FROM levantamiento WHERE id = ?`,
    [id ?? ""],
  );
  return data?.[0] ?? null;
}

export type SkuDeLevantamiento = {
  sku_id: string;
  nombre: string;
  codigo: string;
  ls_id: string | null;
  frentes_propios: number | null;
};

/**
 * Los SKU codificados de la marca en la tienda (derivados de `tienda_sku`), con
 * lo ya registrado por SKU. La tienda sale de la propia visita.
 */
export function useSkusDeLevantamiento(
  visitaId: string,
  marcaId: string,
  levantamientoId: string | null,
) {
  const { data, isLoading } = useQuery<SkuDeLevantamiento>(
    `SELECT s.id AS sku_id, s.nombre AS nombre, s.codigo AS codigo,
            ls.id AS ls_id, ls.frentes_propios AS frentes_propios
     FROM visita v
     JOIN tienda_sku ts ON ts.tienda_id = v.tienda_id AND ts.activo = 1
     JOIN sku s ON s.id = ts.sku_id AND s.marca_id = ? AND s.activo = 1
     LEFT JOIN levantamiento_sku ls
            ON ls.sku_id = s.id AND ls.levantamiento_id = ?
     WHERE v.id = ?
     ORDER BY s.nombre`,
    [marcaId, levantamientoId ?? "", visitaId],
  );
  return { skus: data ?? [], cargando: isLoading };
}

/**
 * Persiste el paso "Antes + Share of Shelf": el SOS agregado en `levantamiento`
 * y los frentes por SKU en `levantamiento_sku` (upsert por (levantamiento, sku),
 * conservando las columnas que llena MAR-38: stock, precio).
 *
 * Las fotos (Antes y SOS) ya se encolaron por la cola de disco; sus FK
 * (`foto_antes_id`, `sos_foto_id`) quedan en null: crear la fila `foto` y
 * enlazarla tras subir a R2 es MAR-39 (igual que la selfie de check-in). Poner
 * aquí un id sin fila `foto` rompería la FK al sincronizar.
 */
export async function guardarAntesSos(d: {
  levantamiento_id: string;
  tenant_id: string;
  frentes_propios: number;
  frentes_competencia: readonly FrenteCompetidor[];
  skus: readonly {
    sku_id: string;
    ls_id: string | null;
    frentes_propios: number;
  }[];
}): Promise<void> {
  await db.execute(
    `UPDATE levantamiento
        SET sos_frentes_propios = ?, sos_frentes_competencia = ?
      WHERE id = ?`,
    [
      d.frentes_propios,
      JSON.stringify(d.frentes_competencia),
      d.levantamiento_id,
    ],
  );
  for (const s of d.skus) {
    if (s.ls_id) {
      await db.execute(
        `UPDATE levantamiento_sku SET frentes_propios = ? WHERE id = ?`,
        [s.frentes_propios, s.ls_id],
      );
    } else {
      await db.execute(
        `INSERT INTO levantamiento_sku
           (id, tenant_id, levantamiento_id, sku_id, frentes_propios)
         VALUES (?, ?, ?, ?, ?)`,
        [
          Crypto.randomUUID(),
          d.tenant_id,
          d.levantamiento_id,
          s.sku_id,
          s.frentes_propios,
        ],
      );
    }
  }
}

/**
 * Registra una contingencia (bypass) de un paso. Al subir, el trigger de MAR-28
 * dispara la alerta al supervisor — la app solo inserta la fila. `registrada_at`
 * es la hora LOCAL de la captura del hallazgo.
 */
export async function registrarContingencia(d: {
  tenant_id: string;
  visita_id: string;
  levantamiento_id: string;
  paso: PasoLevantamiento;
  motivo: string;
  comentario: string | null;
  foto_id: string | null;
}): Promise<void> {
  const id = Crypto.randomUUID();
  await db.execute(
    `INSERT INTO contingencia
       (id, tenant_id, visita_id, levantamiento_id, paso, motivo, comentario,
        registrada_at, foto_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      d.tenant_id,
      d.visita_id,
      d.levantamiento_id,
      d.paso,
      d.motivo,
      d.comentario,
      new Date().toISOString(),
      d.foto_id,
    ],
  );
}
