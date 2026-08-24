import { Constants } from "@market-track/db";
import { z } from "zod";

import { tipoTiendaSchema } from "../enums";

// La configuración de Perfect Store en la frontera: lo que se puede escribir.
//
// El peso y el objetivo de cada variable los fija LA MARCA, no nosotros. Este
// schema es el contrato de esa configuración; el CÁLCULO vive en la base
// (ADR-0011) y no se replica aquí ni en ninguna app — si aparece una función de
// puntaje en este paquete, la decisión ya se rompió.
//
// La tolerancia de precio NO está aquí a propósito: vive en
// `marca.tolerancia_precio_pct` y la usa el motor de alertas. Un segundo dueño
// divergiría.

export const unidadSosSchema = z.enum(Constants.public.Enums.unidad_sos);
export const politicaPopSchema = z.enum(Constants.public.Enums.politica_pop);

export type UnidadSos = z.infer<typeof unidadSosSchema>;
export type PoliticaPop = z.infer<typeof politicaPopSchema>;

/** Los valores del enum, para pintar un desplegable sin escribirlos a mano. */
export const UNIDADES_SOS = Constants.public.Enums.unidad_sos;
export const POLITICAS_POP = Constants.public.Enums.politica_pop;

/** Un peso o un puntaje: un porcentaje con dos decimales, como en la base. */
const porcentaje = (etiqueta: string) =>
  z.number(etiqueta).min(0, "No puede ser negativo").max(100, "Máximo 100");

/** La suma exacta que la base también hace cumplir. */
export const SUMA_DE_PESOS = 100;

/** Un porcentaje como entero de centésimas: la misma precisión que `numeric(5,2)`. */
function centesimas(valor: number): number {
  return Math.round(valor * 100);
}

/**
 * Los cinco pesos de Perfect Store.
 *
 * Suman 100 SIEMPRE, aunque el piloto solo evalúe tres variables: una que no se
 * evalúa **renormaliza** su peso entre las demás, no puntúa cero. Un cero
 * silencioso convertiría una visita incompleta en una tienda mal ejecutada.
 * Declararlos los cinco es lo que hace posible esa renormalización sin adivinar.
 */
export const pesosPerfectStoreSchema = z
  .object({
    peso_distribucion: porcentaje("Escribe el peso de distribución"),
    peso_visibilidad: porcentaje("Escribe el peso de visibilidad"),
    peso_precio: porcentaje("Escribe el peso de precio y promoción"),
    peso_pop: porcentaje("Escribe el peso de material POP"),
    peso_orden: porcentaje("Escribe el peso de orden y limpieza"),
  })
  .refine(
    (p) =>
      // En CENTÉSIMAS ENTERAS, no sumando los decimales. La columna es
      // `numeric(5,2)` —aritmética exacta— pero en JavaScript
      // 28.94 + 35.1 + 9.04 + 7.55 + 19.37 da 100.00000000000001, así que un
      // `=== 100` rechazaría unos pesos que la base acepta sin pestañear. La
      // frontera no puede ser más estricta que lo que guarda.
      centesimas(p.peso_distribucion) +
        centesimas(p.peso_visibilidad) +
        centesimas(p.peso_precio) +
        centesimas(p.peso_pop) +
        centesimas(p.peso_orden) ===
      SUMA_DE_PESOS * 100,
    {
      path: ["peso_distribucion"],
      message: `Los cinco pesos tienen que sumar ${SUMA_DE_PESOS}`,
    },
  );

/**
 * Una configuración nueva.
 *
 * No lleva `id` ni `creado_at`: las filas son INMUTABLES y cambiar la
 * configuración es insertar otra con una `vigente_desde` nueva. No existe un
 * schema de edición porque no existe la edición.
 */
/**
 * Lo que la vista previa del panel manda al servidor: los pesos y la POLÍTICA.
 *
 * La política viaja aunque no se esté guardando nada, porque decide la forma del
 * número: con `bonus_sobre_100` el material POP sale del promedio y se suma por
 * encima. Sin ella, la previa de una marca con bonus saldría hasta `peso_pop`
 * puntos por debajo del total que el motor produce después — una previa que
 * miente sobre el efecto de los pesos que el admin está a punto de publicar.
 *
 * Opcional a propósito: la fila que arma `jsonb_populate_record` en la base es
 * efímera y su columna admite el default, así que una previa sin política sigue
 * siendo válida y cae al modo de tope.
 */
export const previaPerfectStoreSchema = pesosPerfectStoreSchema.and(
  z.object({ politica_pop: politicaPopSchema.optional() }),
);

export type PreviaPerfectStore = z.infer<typeof previaPerfectStoreSchema>;

export const altaConfigPerfectStoreSchema = z
  .object({
    tenant_id: z.guid("Elige un cliente"),
    marca_id: z.guid("Elige una marca"),
    /** Null = aplica a todas las categorías de la marca. */
    categoria_id: z
      .guid()
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    /** Null = aplica a todos los tipos de tienda. */
    tipo_tienda: tipoTiendaSchema
      .nullable()
      .optional()
      .transform((v) => v ?? null),

    sos_objetivo_pct: z
      .number("Escribe el objetivo de share of shelf")
      .gt(0, "Un objetivo de cero no mide nada")
      .max(100, "Máximo 100"),
    sos_unidad: unidadSosSchema.default("frentes"),
    politica_pop: politicaPopSchema.default("dentro_del_tope"),

    orden_bien_pts: porcentaje("Escribe el puntaje de «bien»").default(100),
    orden_regular_pts: porcentaje("Escribe el puntaje de «regular»").default(
      50,
    ),
    orden_mal_pts: porcentaje("Escribe el puntaje de «mal»").default(0),

    vigente_desde: z.iso.date("Escribe desde cuándo rige"),
  })
  .and(pesosPerfectStoreSchema)
  // Un "regular" que valga más que "bien" invierte la escala en silencio: el
  // puntaje sale igual, premiando lo contrario de lo que se quería medir.
  .refine((c) => c.orden_bien_pts >= c.orden_regular_pts, {
    path: ["orden_regular_pts"],
    message: "«Regular» no puede valer más que «bien»",
  })
  .refine((c) => c.orden_regular_pts >= c.orden_mal_pts, {
    path: ["orden_mal_pts"],
    message: "«Mal» no puede valer más que «regular»",
  });

export type AltaConfigPerfectStore = z.infer<
  typeof altaConfigPerfectStoreSchema
>;
