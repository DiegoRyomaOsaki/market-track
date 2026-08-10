import { Constants } from "@market-track/db";
import { z } from "zod";

// Validación de los hechos comerciales del maestro —precio regular, promoción y
// exhibición negociada— en la frontera del formulario.
//
// Los tres en un módulo porque comparten la forma: una vigencia, unas referencias
// al catálogo y una clave natural que la base hace cumplir. Partirlo por sección
// del panel duplicaría el mapeo de errores de Postgres, que es lo mismo para los
// tres.
//
// Los enums salen de `Constants` (la base), nunca escritos a mano: una segunda
// lista se queda vieja en silencio cuando una migración añade un tipo.

/** Un importe en soles: la columna es `numeric(10,2)` con check `>= 0`. */
const importe = (etiqueta: string) =>
  z
    .number(etiqueta)
    .min(0, "No puede ser negativo")
    .max(99_999_999.99, "Demasiado grande");

const fecha = z.iso.date("Escribe una fecha");

/**
 * Precio regular por SKU y cadena.
 *
 * La clave natural de la base es
 * `(tenant_id, sku_id, cadena_id, tipo_tienda, vigente_desde)` con
 * `nulls not distinct`: dos precios sin tipo de tienda colisionan en vez de
 * duplicarse. `vigente_desde` forma parte de la clave, así que cambiar el precio
 * a partir de una fecha nueva es un alta, no una edición.
 */
export const altaPrecioRegularSchema = z.object({
  tenant_id: z.guid("Elige un cliente"),
  sku_id: z.guid("Elige un SKU"),
  cadena_id: z.guid("Elige una cadena"),
  tipo_tienda: z
    .enum(Constants.public.Enums.tipo_tienda)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  precio: importe("Escribe el precio"),
  vigente_desde: fecha,
});

export type AltaPrecioRegular = z.infer<typeof altaPrecioRegularSchema>;

/**
 * Promoción con vigencia.
 *
 * `clusters` acota la promo a unos clusters de tienda; vacío significa TODAS las
 * tiendas, que es el caso normal. El catálogo de clusters es otro ticket: aquí
 * son los valores que ya existen en `tienda.cluster`.
 *
 * `comunicada` no es decoración: es la pregunta que bifurca el árbol de decisión
 * de precios del levantamiento.
 */
export const altaPromocionSchema = z
  .object({
    tenant_id: z.guid("Elige un cliente"),
    sku_id: z.guid("Elige un SKU"),
    precio_promo: importe("Escribe el precio promocional"),
    fecha_inicio: fecha,
    fecha_fin: fecha,
    // Acotado por elemento y por longitud: es un `text[]` sin más límite que el
    // de la fila, y lo que entra aquí se sirve entero en cada lectura del
    // listado. `tienda.cluster` no pasa de un nombre corto.
    clusters: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
    comunicada: z.boolean().default(false),
  })
  .refine((p) => p.fecha_fin >= p.fecha_inicio, {
    path: ["fecha_fin"],
    message: "La promoción no puede terminar antes de empezar",
  });

export type AltaPromocion = z.infer<typeof altaPromocionSchema>;

/**
 * Exhibición negociada por tienda.
 *
 * La negocia UNA MARCA, no el cliente entero: la misma tienda puede tener una
 * cabecera de Oster y una isla de Sharpie. Su clave natural
 * `(tenant_id, tienda_id, marca_id, tipo, fecha_inicio)` es de esta rama.
 *
 * `sku_ids` vacío es válido y frecuente: se negocia el espacio antes de decidir
 * qué SKUs lo ocupan.
 */
export const altaExhibicionSchema = z
  .object({
    tenant_id: z.guid("Elige un cliente"),
    tienda_id: z.guid("Elige una tienda"),
    marca_id: z.guid("Elige una marca"),
    tipo: z.enum(Constants.public.Enums.tipo_exhibicion, "Elige un tipo"),
    // La columna es un `uuid[]` SIN clave foránea: la base no comprueba de quién
    // es cada elemento. De eso responde la acción; aquí solo se acota el tamaño.
    sku_ids: z.array(z.guid()).max(500).default([]),
    cantidad_sugerida: z
      .number()
      .int("Unidades enteras")
      .min(0, "No puede ser negativa")
      .max(100_000, "Demasiadas unidades")
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    fecha_inicio: fecha,
    fecha_fin: fecha,
  })
  .refine((e) => e.fecha_fin >= e.fecha_inicio, {
    path: ["fecha_fin"],
    message: "La exhibición no puede terminar antes de empezar",
  });

export type AltaExhibicion = z.infer<typeof altaExhibicionSchema>;
