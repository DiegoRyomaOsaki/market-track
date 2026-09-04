import { Constants } from "@market-track/db";
import { z } from "zod";

import { puntoEwkt } from "@/lib/mapa/geo";

// Validación del catálogo (cadenas y tiendas) en la frontera del formulario.

/** Texto opcional que en la base es NULL cuando no se llena. */
const textoOpcional = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null);

const nombre = z.string().trim().min(1, "Requerido");

// El enum sale de la base (`Constants`), nunca escrito a mano: una segunda lista
// se queda vieja en silencio cuando una migración añade un tipo.
export const altaCadenaSchema = z.object({
  nombre,
  tenant_id: z.guid("Elige un cliente"),
  tipo_tienda: z
    .enum(Constants.public.Enums.tipo_tienda)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  codigo_externo: textoOpcional,
  activo: z.boolean().default(true),
});

export type AltaCadena = z.infer<typeof altaCadenaSchema>;

/**
 * La categoría de producto: el eje por el que se pondera Perfect Store.
 *
 * Es del CLIENTE, no de la marca — "Bebidas" agrupa SKUs de varias marcas suyas.
 */
export const altaCategoriaSchema = z.object({
  nombre,
  tenant_id: z.guid("Elige un cliente"),
  codigo_externo: textoOpcional,
  activo: z.boolean().default(true),
});

export type AltaCategoria = z.infer<typeof altaCategoriaSchema>;

export const altaTiendaSchema = z.object({
  nombre,
  tenant_id: z.guid("Elige un cliente"),
  cadena_id: z.guid("Elige una cadena"),
  direccion: textoOpcional,
  // Sin punto no hay geocerca: el mercaderista no podría hacer check-in.
  lat: z.number("Marca la tienda en el mapa").min(-90).max(90),
  lon: z.number("Marca la tienda en el mapa").min(-180).max(180),
  // La base exige `radio_geocerca_m > 0` y la columna es integer. El default de
  // 100 m es el de la propuesta (subió desde 50), editable por tienda.
  radio_geocerca_m: z
    .number("Escribe un radio en metros")
    .int("Metros enteros")
    .positive("Tiene que ser mayor que 0")
    .default(100),
  cluster: textoOpcional,
  codigo_externo: textoOpcional,
  activo: z.boolean().default(true),
});

export type AltaTienda = z.infer<typeof altaTiendaSchema>;

/**
 * La fila que va a PostgREST: lat/lon se funden en `ubicacion` (EWKT).
 *
 * `lat` y `lon` son columnas GENERADAS — mandarlas revienta en runtime aunque
 * los tipos de Supabase las ofrezcan en `Insert`. Por eso esta función existe:
 * es el único sitio donde se decide qué viaja.
 */
export function aFilaTienda(t: AltaTienda) {
  const { lat, lon, ...resto } = t;
  return { ...resto, ubicacion: puntoEwkt(lat, lon) };
}

// El SKU cuelga de la MARCA, no del cliente: una tienda vende varias marcas del
// mismo cliente y cada SKU pertenece a una.
export const altaSkuSchema = z.object({
  nombre,
  tenant_id: z.guid("Elige un cliente"),
  marca_id: z.guid("Elige una marca"),
  /**
   * OPCIONAL: el maestro se carga poco a poco y un SKU sin categoría tiene que
   * poder existir. La FK compuesta `(categoria_id, tenant_id)` es la que impide
   * apuntar a la categoría de otro cliente.
   */
  categoria_id: z
    .guid()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  codigo: z.string().trim().min(1, "Requerido"),
  presentacion: textoOpcional,
  codigo_barras: textoOpcional,
  codigo_externo: textoOpcional,
  activo: z.boolean().default(true),
});

export type AltaSku = z.infer<typeof altaSkuSchema>;

// Una celda de la matriz de codificados: qué SKU está autorizado en qué tienda.
// `activo` es explícito a propósito — codificar y descodificar son dos acciones
// distintas, no la presencia o ausencia de una casilla.
//
// El `tenant_id` NO viaja aquí: lo re-deriva el servidor de la tienda. La
// política de escritura de `tienda_sku` solo comprueba que quien escribe es
// admin (staff, sin tenant), así que el aislamiento de esa fila lo sostiene la
// FK compuesta — y el tenant no puede venir del cliente.
export const codificadoSchema = z.object({
  tienda_id: z.guid(),
  sku_id: z.guid(),
  activo: z.boolean(),
});

export type Codificado = z.infer<typeof codificadoSchema>;
