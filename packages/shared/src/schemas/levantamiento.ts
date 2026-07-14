import { z } from "zod";

import {
  estadoLevantamientoSchema,
  estadoVisitaSchema,
  pasoLevantamientoSchema,
  tipoExhibicionSchema,
  tipoFotoSchema,
} from "../enums";

// Lo que el MÓVIL SUBE. Es la frontera más importante del sistema: entrada
// generada por un cliente que corre en el teléfono de otra persona, sincronizada
// horas después, y que acaba en la base de datos de un cliente real.
//
// Estos esquemas NO son un espejo de la fila. Omiten a propósito tres clases de
// campo, y esa omisión es la mitad del valor:
//
//   1. Los DERIVADOS (`quiebre`, `diferencia`) — los calcula la base. Postgres
//      rechazaría la escritura igualmente, pero con un error de columna generada
//      que no dice nada. Aquí falla en la frontera, con un mensaje que se entiende.
//   2. Los de SERVIDOR (`tenant_id`, `creado_at`) — el tenant sale del JWT vía
//      RLS, nunca del payload. Aceptarlo del cliente sería dejar que el atacante
//      elija su propio aislamiento.
//   3. Lo que decide la base (`id` por defecto).

// `z.guid()`, no `z.uuid()`.
//
// `z.uuid()` valida RFC 9562 ESTRICTO: exige que los bits de versión y variante
// sean correctos. Postgres NO — su tipo `uuid` acepta cualquier hexadecimal con
// el formato correcto, y de hecho los UUIDs de nuestro propio seed
// (`11111111-1111-...`) no cumplen el RFC.
//
// Con `z.uuid()`, la frontera rechazaría filas que la base considera
// perfectamente válidas. `z.guid()` valida el formato sin exigir versión, que es
// exactamente la semántica de Postgres. Lo cazó el test.
const uuid = z.guid();

/** Momento de captura en el teléfono. Puede llegar horas después del hecho. */
const instante = z.iso.datetime({ offset: true });

/**
 * Un frente de competencia. `competidor` es TEXTO LIBRE (Frutísima, Selva Viva):
 * no es la entidad `marca`, que solo modela las marcas de nuestros clientes.
 */
export const frenteCompetenciaSchema = z.object({
  competidor: z.string().min(1).max(120),
  frentes: z.number().int().min(0),
});

export const visitaUploadSchema = z.object({
  id: uuid,
  rutero_parada_id: uuid,
  mercaderista_id: uuid,
  tienda_id: uuid,
  // La hora del teléfono es una SUGERENCIA: se puede cambiar a mano en los
  // ajustes. El servidor la re-sella al sincronizar. Ver docs/02.
  check_in_at: instante,
  check_out_at: instante.nullish(),
  estado: estadoVisitaSchema,
  bitacora: z.string().max(2000).nullish(),
  tiempo_traslado_min: z.number().int().min(0).nullish(),
  bateria_inicio_pct: z.number().int().min(0).max(100).nullish(),
  selfie_foto_id: uuid.nullish(),
});

export const levantamientoUploadSchema = z.object({
  id: uuid,
  visita_id: uuid,
  // Una visita produce un levantamiento POR MARCA: cada marca vive en un pasillo
  // distinto y tiene su propia góndola.
  marca_id: uuid,
  sos_frentes_propios: z.number().int().min(0).nullish(),
  sos_frentes_competencia: z.array(frenteCompetenciaSchema).default([]),
  estado: estadoLevantamientoSchema,
  foto_antes_id: uuid.nullish(),
  foto_despues_id: uuid.nullish(),
  sos_foto_id: uuid.nullish(),
});

export const levantamientoSkuUploadSchema = z.object({
  id: uuid,
  levantamiento_id: uuid,
  sku_id: uuid,
  frentes_propios: z.number().int().min(0).nullish(),
  frentes_competencia: z.array(frenteCompetenciaSchema).default([]),
  stock_sistema: z.number().int().min(0).nullish(),
  stock_piso: z.number().int().min(0).nullish(),
  precio_registrado: z.number().min(0).nullish(),
  hay_promo: z.boolean().nullish(),
  promo_comunicada: z.boolean().nullish(),
  sos_foto_id: uuid.nullish(),
  // `quiebre` y `diferencia` NO están, y es deliberado: los calcula la base.
});

/**
 * El bypass. Compromiso de la propuesta aceptada: el levantamiento es secuencial
 * pero no un bloqueo absoluto — el mercaderista registra el hallazgo y continúa.
 */
export const contingenciaUploadSchema = z.object({
  id: uuid,
  visita_id: uuid,
  // Null si el paso omitido es de la VISITA (check-in/check-out); poblado si es de
  // una marca concreta.
  levantamiento_id: uuid.nullish(),
  paso: pasoLevantamientoSchema,
  // Obligatorio: una contingencia sin motivo no es una contingencia, es un salto.
  motivo: z.string().min(1).max(500),
  comentario: z.string().max(2000).nullish(),
  registrada_at: instante,
  foto_id: uuid.nullish(),
});

export const fotoUploadSchema = z.object({
  id: uuid,
  visita_id: uuid,
  levantamiento_id: uuid.nullish(),
  tipo: tipoFotoSchema,
  url_r2: z.string().nullish(),
  hash: z.string().nullish(),
  // Se graba AL CAPTURAR, igual que el watermark. Una foto marcada al subir no
  // prueba nada: la subida puede ocurrir horas después.
  capturada_at: instante,
});

export const exhibicionUploadSchema = z
  .object({
    id: uuid,
    levantamiento_id: uuid,
    exhibicion_negociada_id: uuid.nullish(),
    tipo_adicional: tipoExhibicionSchema.nullish(),
    instalada: z.boolean().nullish(),
    unidades: z.number().int().min(0).nullish(),
    completa: z.boolean().nullish(),
    vigente: z.boolean().nullish(),
    foto_id: uuid.nullish(),
  })
  // O es una exhibición negociada, o es una adicional. Nunca las dos, nunca
  // ninguna — el mismo CHECK que tiene la tabla, aplicado en la frontera.
  .refine(
    (e) =>
      (e.exhibicion_negociada_id != null && e.tipo_adicional == null) ||
      (e.exhibicion_negociada_id == null && e.tipo_adicional != null),
    {
      message:
        "Una exhibición es negociada (exhibicion_negociada_id) o adicional (tipo_adicional), nunca ambas ni ninguna",
    },
  );

export type VisitaUpload = z.infer<typeof visitaUploadSchema>;
export type LevantamientoUpload = z.infer<typeof levantamientoUploadSchema>;
export type LevantamientoSkuUpload = z.infer<
  typeof levantamientoSkuUploadSchema
>;
export type ContingenciaUpload = z.infer<typeof contingenciaUploadSchema>;
export type FotoUpload = z.infer<typeof fotoUploadSchema>;
export type ExhibicionUpload = z.infer<typeof exhibicionUploadSchema>;
export type FrenteCompetencia = z.infer<typeof frenteCompetenciaSchema>;
