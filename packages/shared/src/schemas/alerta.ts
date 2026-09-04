import { z } from "zod";

import {
  estadoAlertaSchema,
  pasoLevantamientoSchema,
  severidadAlertaSchema,
  type TipoAlerta,
  tipoAlertaSchema,
} from "../enums";
import { periodoPuntajeSchema } from "./perfect-merchandiser";

// La forma de lo que devuelven `bandeja_alertas` y `detalle_alerta`, y —lo que
// más importa— la del `payload` que escribe el motor de alertas.
//
// El payload es un `jsonb` sin forma declarada en la base: el motor lo construye
// con `jsonb_build_object` y el portal lo lee. Son dos archivos que nadie compila
// juntos, así que el contrato se fija aquí y falla en el borde, con un mensaje
// que se entiende, en vez de pintar `undefined` en la pantalla del cliente.

const uuid = z.guid();
const instante = z.iso.datetime({ offset: true });

// Ningún payload lleva `.strict()`: si el motor añade una clave, el portal la
// ignora en vez de romperse. La rigidez aquí solo serviría para que un despliegue
// del motor tumbe una pantalla que no le hacía falta cambiar.

const quiebreSchema = z.object({
  sku_id: uuid,
  stock_sistema: z.number().nullable(),
  stock_piso: z.number().nullable(),
});

const diferenciaStockSchema = quiebreSchema.extend({
  delta: z.number().nullable(),
});

const desviacionPrecioSchema = z.object({
  sku_id: uuid,
  precio_registrado: z.number(),
  precio_regular: z.number(),
  /** Por encima del regular, o por debajo sin promoción que lo justifique. */
  motivo: z.enum(["sobreprecio", "subvaluado_sin_promo"]),
});

const promoNoActivaSchema = z.object({
  sku_id: uuid,
  precio_registrado: z.number(),
  precio_regular: z.number(),
});

const contingenciaSchema = z.object({
  paso: pasoLevantamientoSchema,
  motivo: z.string(),
});

const exhibicionIncompletaSchema = z.object({
  exhibicion_id: uuid,
  unidades: z.number().nullable(),
});

/**
 * El guardarraíl del plan de lealtad: el periodo no se cerró porque demasiada
 * evidencia subida sigue sin el sello del servidor (una caída de R2 o una
 * rotación de credenciales lo provocan).
 *
 * Es una alerta de STAFF: nunca llega al portal del cliente-marca. Y las cifras
 * son las de la PRIMERA detección — la alerta es una por mercaderista y periodo,
 * no se re-emite. Lo vivo está en `puntaje_merchandiser`.
 */
const verificacionFotosSchema = z.object({
  mercaderista_id: uuid,
  periodo_tipo: periodoPuntajeSchema,
  periodo_inicio: z.iso.date(),
  fotos_subidas: z.number(),
  fotos_verificadas: z.number(),
  pct_sin_verificar: z.number(),
  umbral_pct: z.number(),
});

/**
 * El payload que corresponde a cada tipo de alerta.
 *
 * Es un `Record` de todos los tipos y no un `switch`: si el enum crece, esto deja
 * de compilar en vez de dejar que el tipo nuevo caiga en un caso por defecto y
 * aparezca en producción sin nadie mirándolo.
 */
export const PAYLOAD_ALERTA = {
  quiebre: quiebreSchema,
  diferencia_stock: diferenciaStockSchema,
  desviacion_precio: desviacionPrecioSchema,
  promo_no_activa: promoNoActivaSchema,
  contingencia: contingenciaSchema,
  exhibicion_incompleta: exhibicionIncompletaSchema,
  verificacion_fotos: verificacionFotosSchema,
} as const satisfies Record<TipoAlerta, z.ZodType>;

export type PayloadAlerta = {
  [K in TipoAlerta]: z.infer<(typeof PAYLOAD_ALERTA)[K]>;
};

const fotoDeAlertaSchema = z.object({
  id: uuid,
  capturada_at: instante,
  /** Nulo mientras el binario siga en el teléfono: no hay nada que firmar. */
  subida_at: instante.nullable(),
  /**
   * Si es `false`, la foto es la del PASO de la visita, no la del hallazgo
   * concreto. Solo la contingencia guarda su propia foto; en el resto de tipos el
   * móvil no escribe el enlace, así que lo más que se puede ofrecer es la foto de
   * ese paso. La pantalla tiene que rotularlo — enseñarla como si fuera la del
   * SKU que disparó la alerta sería inventarse la evidencia.
   */
  del_hallazgo: z.boolean(),
});

export const detalleAlertaSchema = z.object({
  id: uuid,
  tipo: tipoAlertaSchema,
  severidad: severidadAlertaSchema,
  estado: estadoAlertaSchema,
  creado_at: instante,
  /** Crudo: darle forma de presentación es cosa de la app, no del SQL. */
  payload: z.unknown(),
  tienda_nombre: z.string().nullable(),
  cadena_nombre: z.string().nullable(),
  marca_nombre: z.string().nullable(),
  sku_codigo: z.string().nullable(),
  sku_nombre: z.string().nullable(),
  visita_id: uuid.nullable(),
  visita_check_in_at: instante.nullable(),
  /**
   * La ventana del precio esperado, resuelta a la fecha de la VISITA.
   *
   * Nulas cuando la alerta no es de precio, o cuando no había precio vigente
   * ese día. `precio_vigente_hasta` nula con `desde` presente significa que el
   * periodo sigue abierto, no que falte el dato.
   */
  precio_vigente_desde: z.iso.date().nullable().default(null),
  precio_vigente_hasta: z.iso.date().nullable().default(null),
  foto: fotoDeAlertaSchema.nullable(),
});

export type DetalleAlerta = z.infer<typeof detalleAlertaSchema>;
export type FotoDeAlerta = z.infer<typeof fotoDeAlertaSchema>;
