import { z } from "zod";

import {
  decisionRevisionSchema,
  estadoLevantamientoSchema,
  nivelOrdenSchema,
  pasoLevantamientoSchema,
  tipoFotoSchema,
} from "../enums";

// La forma del reporte que devuelve `detalle_visita`.
//
// Aquí el esquema no valida entrada de un cliente: valida la salida de nuestra
// propia base. Se parsea igual, y por dos razones. Una, `jsonb` llega a
// TypeScript como `Json`, o sea `unknown` con pasos extra: sin esto, la pantalla
// del detalle se escribiría a base de casts. Y dos, la función SQL y esta forma
// son un contrato entre dos archivos que nadie compila juntos — el día que la
// migración renombre una clave, esto falla en el borde con un mensaje que se
// entiende, en vez de pintar celdas vacías.

const uuid = z.guid();
const instante = z.iso.datetime({ offset: true });

const skuRevisadoSchema = z.object({
  codigo: z.string(),
  nombre: z.string(),
  stock_sistema: z.number().int().nullable(),
  stock_piso: z.number().int().nullable(),
  // Derivados en la base (columnas generadas). Se leen, jamás se recalculan.
  quiebre: z.boolean().nullable(),
  diferencia: z.boolean().nullable(),
  precio_registrado: z.number().nullable(),
  hay_promo: z.boolean().nullable(),
  promo_comunicada: z.boolean().nullable(),
});

const exhibicionRevisadaSchema = z.object({
  tipo: z.string().nullable(),
  negociada: z.boolean(),
  instalada: z.boolean().nullable(),
  unidades: z.number().int().nullable(),
  completa: z.boolean().nullable(),
  vigente: z.boolean().nullable(),
});

const respuestaRevisadaSchema = z.object({
  campo_id: z.string(),
  valor: z.unknown(),
});

const levantamientoRevisadoSchema = z.object({
  id: uuid,
  marca_nombre: z.string(),
  estado: estadoLevantamientoSchema,
  sos_frentes_propios: z.number().int().nullable(),
  sos_frentes_competencia: z.unknown(),
  /** Null cuando el paso se omitió por contingencia: no evaluada, no "mal". */
  orden_nivel: nivelOrdenSchema.nullable(),
  orden_foto_id: uuid.nullable(),
  skus: z.array(skuRevisadoSchema),
  exhibiciones: z.array(exhibicionRevisadaSchema),
  respuestas: z.array(respuestaRevisadaSchema),
});

const contingenciaRevisadaSchema = z.object({
  paso: pasoLevantamientoSchema,
  motivo: z.string(),
  comentario: z.string().nullable(),
  registrada_at: instante,
  levantamiento_id: uuid.nullable(),
});

const fotoRevisadaSchema = z.object({
  id: uuid,
  levantamiento_id: uuid.nullable(),
  tipo: tipoFotoSchema,
  capturada_at: instante,
  // Nula mientras la evidencia siga en el teléfono. No hay nada que firmar en R2
  // hasta que la cola de subida la suba, así que el panel lo dice en vez de
  // enseñar una imagen rota.
  subida_at: instante.nullable(),
});

export const detalleVisitaSchema = z.object({
  visita: z.object({
    id: uuid,
    tienda_nombre: z.string(),
    cadena_nombre: z.string(),
    mercaderista_nombre: z.string(),
    check_in_at: instante,
    check_out_at: instante.nullable(),
    duracion_min: z.number().int().nullable(),
    check_in_geocerca_ok: z.boolean().nullable(),
    check_out_geocerca_ok: z.boolean().nullable(),
    bitacora: z.string().nullable(),
    tiempo_traslado_min: z.number().int().nullable(),
    bateria_inicio_pct: z.number().int().nullable(),
  }),
  revision: z
    .object({
      decision: decisionRevisionSchema,
      motivo: z.string().nullable(),
      revisor_nombre: z.string().nullable(),
      revisado_at: instante,
    })
    .nullable(),
  levantamientos: z.array(levantamientoRevisadoSchema),
  contingencias: z.array(contingenciaRevisadaSchema),
  fotos: z.array(fotoRevisadaSchema),
});

export type DetalleVisita = z.infer<typeof detalleVisitaSchema>;
export type LevantamientoRevisado = z.infer<typeof levantamientoRevisadoSchema>;
export type FotoRevisada = z.infer<typeof fotoRevisadaSchema>;
export type ContingenciaRevisada = z.infer<typeof contingenciaRevisadaSchema>;
