import { z } from "zod";

import { tipoTiendaSchema } from "../enums";

// El maestro comercial que el cliente manda en un Excel, ya parseado y listo para
// aplicar. Estos schemas son la FRONTERA: nada llega a Postgres sin pasar por
// aquí, que es el criterio de aceptación "la validación ocurre en la frontera
// antes de tocar la base".
//
// NINGUNA fila lleva `tenant_id`. El tenant sale de la fila `importacion` dentro
// de la transacción, nunca del payload: un lote no puede elegir en qué cliente
// escribe.

const fecha = z.iso.date();

/** Texto de una celda: se recorta y una celda en blanco cuenta como ausente. */
const texto = (max: number) => z.string().trim().min(1).max(max);
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable();

/**
 * La clave natural con la que el cliente identifica sus cosas.
 *
 * Obligatoria aunque la columna sea nullable en la base: `unique (tenant_id,
 * codigo_externo)` no colisiona con NULL —en SQL dos nulos son distintos—, así
 * que una fila sin código se insertaría otra vez en cada import.
 */
const codigoExterno = texto(64);

export const filaMarcaSchema = z.object({
  codigo_externo: codigoExterno,
  nombre: texto(200),
  tolerancia_precio_pct: z.number().min(0).max(100).nullable(),
});

export const filaCadenaSchema = z.object({
  codigo_externo: codigoExterno,
  nombre: texto(200),
  tipo_tienda: tipoTiendaSchema.nullable(),
});

export const filaSkuSchema = z.object({
  codigo_externo: codigoExterno,
  marca_codigo_externo: codigoExterno,
  codigo: texto(64),
  nombre: texto(200),
  presentacion: textoOpcional(120),
  codigo_barras: textoOpcional(64),
});

export const filaTiendaSchema = z
  .object({
    codigo_externo: codigoExterno,
    cadena_codigo_externo: codigoExterno,
    nombre: texto(200),
    direccion: textoOpcional(300),
    lat: z.number().min(-90).max(90).nullable(),
    lon: z.number().min(-180).max(180).nullable(),
    radio_geocerca_m: z.number().int().positive().max(5_000).nullable(),
    cluster: textoOpcional(64),
  })
  // Media coordenada no ubica nada, y guardarla dejaría una geocerca en el
  // meridiano de Greenwich con la que ningún check-in cuadraría.
  .refine((t) => (t.lat === null) === (t.lon === null), {
    path: ["lat"],
    message: "Latitud y longitud van juntas: o las dos o ninguna",
  });

export const filaTiendaSkuSchema = z.object({
  tienda_codigo_externo: codigoExterno,
  sku_codigo_externo: codigoExterno,
});

export const filaPrecioRegularSchema = z.object({
  sku_codigo_externo: codigoExterno,
  cadena_codigo_externo: codigoExterno,
  tipo_tienda: tipoTiendaSchema.nullable(),
  precio: z.number().min(0).max(1_000_000),
  /** Parte de la clave natural: sin ella el reimport duplicaría en vez de actualizar. */
  vigente_desde: fecha,
});

export const filaPromocionSchema = z
  .object({
    sku_codigo_externo: codigoExterno,
    precio_promo: z.number().min(0).max(1_000_000),
    fecha_inicio: fecha,
    fecha_fin: fecha,
    /** Nulo si la casilla venía vacía: se conserva lo que hubiera. */
    comunicada: z.boolean().nullable(),
  })
  .refine((p) => p.fecha_fin >= p.fecha_inicio, {
    path: ["fecha_fin"],
    message: "La promoción no puede terminar antes de empezar",
  });

/** El lote entero, ya validado. Es lo que recibe la función que lo aplica. */
export const loteImportacionSchema = z.object({
  marca: z.array(filaMarcaSchema),
  cadena: z.array(filaCadenaSchema),
  sku: z.array(filaSkuSchema),
  tienda: z.array(filaTiendaSchema),
  tienda_sku: z.array(filaTiendaSkuSchema),
  precio_regular: z.array(filaPrecioRegularSchema),
  promocion: z.array(filaPromocionSchema),
});

/**
 * Un error de una fila concreta.
 *
 * La forma la fija el comentario de la columna `importacion.errores`:
 * `[{hoja, fila, columna, valor, mensaje}]`. La pantalla los pinta tal cual.
 */
export const errorImportacionSchema = z.object({
  hoja: z.string(),
  /** El número de fila DEL EXCEL, contando la cabecera: es lo que el operador ve. */
  fila: z.number().int().positive(),
  columna: z.string().nullable(),
  valor: z.string().max(120).nullable(),
  mensaje: z.string().max(300),
});

export const resumenImportacionSchema = z.object({
  filas: z.record(z.string(), z.number().int().nonnegative()),
  errores_totales: z.number().int().nonnegative(),
  errores_omitidos: z.number().int().nonnegative(),
});

export type LoteImportacion = z.infer<typeof loteImportacionSchema>;
export type ErrorImportacion = z.infer<typeof errorImportacionSchema>;
export type ResumenImportacion = z.infer<typeof resumenImportacionSchema>;
export type FilaTienda = z.infer<typeof filaTiendaSchema>;
