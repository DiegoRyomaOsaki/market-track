import { Constants } from "@market-track/db";
import { z } from "zod";

// El plan de lealtad del mercaderista en la frontera: lo que se puede escribir.
//
// Puntúa SOLO lo que el mercaderista controla — puntualidad, asistencia, calidad
// de su registro y las herramientas que lleva. Perfect Store no sirve para
// evaluarlo: el que atiende tiendas de provincia nunca competiría con el de la
// tienda grande.
//
// Este schema es el contrato de la CONFIGURACIÓN. El cálculo vive en la base
// (ADR-0011) y no se replica aquí ni en ninguna app — si aparece una función de
// puntaje en este paquete, la decisión ya se rompió.

/** Un peso: un porcentaje con dos decimales, como en la base. */
const porcentaje = (etiqueta: string) =>
  z.number(etiqueta).min(0, "No puede ser negativo").max(100, "Máximo 100");

/** La suma exacta que la base también hace cumplir. */
export const SUMA_DE_PESOS_MERCHANDISER = 100;

/** Un porcentaje como entero de centésimas: la misma precisión que `numeric(5,2)`. */
function centesimas(valor: number): number {
  return Math.round(valor * 100);
}

/** Cada cuánto se cierra y se paga el plan. Del PLAN, no de cada nivel de bono. */
export const periodoPuntajeSchema = z.enum(
  Constants.public.Enums.periodo_puntaje,
);
export const PERIODOS_PUNTAJE = Constants.public.Enums.periodo_puntaje;
export type PeriodoPuntaje = z.infer<typeof periodoPuntajeSchema>;

/**
 * Los cinco pesos del plan de lealtad.
 *
 * El del tiempo efectivo de atención está fijado a 0: la variable existe pero no
 * tiene fórmula acordada —"puede ser un incentivo perverso de que haga todo mal
 * y rápido"—, y con un peso libre la renormalización lo repartiría entre las
 * otras cuatro EN SILENCIO. Encenderla es una migración, no un cambio de
 * configuración. La base lo hace cumplir con un CHECK.
 */
export const pesosMerchandiserSchema = z
  .object({
    peso_puntualidad: porcentaje("Escribe el peso de puntualidad"),
    peso_asistencia: porcentaje("Escribe el peso de asistencia"),
    peso_tiempo_efectivo: z.literal(
      0,
      "El tiempo efectivo de atención todavía no se puntúa: su peso tiene que ser 0",
    ),
    peso_calidad: porcentaje("Escribe el peso de calidad de registro"),
    peso_herramientas: porcentaje("Escribe el peso de herramientas de trabajo"),
  })
  .refine(
    (p) =>
      // En CENTÉSIMAS ENTERAS, no sumando los decimales: la columna es
      // `numeric(5,2)` (aritmética exacta) pero en JavaScript
      // 28.94 + 35.1 + 16.59 + 19.37 da 100.00000000000001, y un `=== 100`
      // rechazaría unos pesos que la base acepta sin pestañear. La frontera no
      // puede ser más estricta que lo que guarda.
      centesimas(p.peso_puntualidad) +
        centesimas(p.peso_asistencia) +
        centesimas(p.peso_tiempo_efectivo) +
        centesimas(p.peso_calidad) +
        centesimas(p.peso_herramientas) ===
      SUMA_DE_PESOS_MERCHANDISER * 100,
    {
      path: ["peso_puntualidad"],
      message: `Los pesos tienen que sumar ${SUMA_DE_PESOS_MERCHANDISER}`,
    },
  );

/**
 * Una configuración nueva.
 *
 * No lleva `id` ni `creado_at`: las filas son INMUTABLES y cambiar la
 * configuración es insertar otra con una `vigente_desde` nueva.
 */
export const altaConfigMerchandiserSchema = z
  .object({
    // `z.guid()` y no `z.uuid()`: el estricto exige los bits de versión del RFC
    // 9562, que Postgres no impone y los ids del seed no cumplen.
    tenant_id: z.guid("Elige un cliente"),
    peso_puntualidad: porcentaje("Escribe el peso de puntualidad"),
    peso_asistencia: porcentaje("Escribe el peso de asistencia"),
    peso_tiempo_efectivo: z.literal(
      0,
      "El tiempo efectivo de atención todavía no se puntúa: su peso tiene que ser 0",
    ),
    peso_calidad: porcentaje("Escribe el peso de calidad de registro"),
    peso_herramientas: porcentaje("Escribe el peso de herramientas de trabajo"),

    // La POLÍTICA de puntualidad. Vive aquí y no en el cliente porque el valor
    // del cliente es editable y movería el puntaje de un periodo abierto.
    tolerancia_puntualidad_min: z
      .number("Escribe los minutos de tolerancia")
      .int("Tienen que ser minutos enteros")
      .min(0, "No puede ser negativa"),
    minutos_tardanza_cero: z
      .number("Escribe a partir de cuántos minutos la parada no puntúa")
      .int("Tienen que ser minutos enteros")
      .positive("Tiene que ser mayor que cero"),
    dias_gracia_cierre: z
      .number("Escribe los días de gracia")
      .int("Tienen que ser días enteros")
      .min(0, "No puede ser negativo"),

    // Con default para no romper a quien ya publicaba sin ella: la columna nació
    // con `default 'mensual'` y el alta clásica no la enviaba.
    periodicidad: periodoPuntajeSchema.default("mensual"),

    vigente_desde: z.iso.date("Elige desde cuándo rige"),
  })
  .refine(
    (c) =>
      centesimas(c.peso_puntualidad) +
        centesimas(c.peso_asistencia) +
        centesimas(c.peso_tiempo_efectivo) +
        centesimas(c.peso_calidad) +
        centesimas(c.peso_herramientas) ===
      SUMA_DE_PESOS_MERCHANDISER * 100,
    {
      path: ["peso_puntualidad"],
      message: `Los pesos tienen que sumar ${SUMA_DE_PESOS_MERCHANDISER}`,
    },
  )
  .refine((c) => c.minutos_tardanza_cero > c.tolerancia_puntualidad_min, {
    path: ["minutos_tardanza_cero"],
    message:
      "Tiene que ser mayor que la tolerancia: entre las dos va la rampa que baja el puntaje",
  });

export type AltaConfigMerchandiser = z.infer<
  typeof altaConfigMerchandiserSchema
>;

/**
 * Un peldaño de la escalera de bonos: "desde este puntaje, este monto".
 *
 * Umbral y no rango (min + max): un rango admite huecos —nadie cobra entre 70 y
 * 75— y solapes —dos niveles compitiendo—, los dos como errores de
 * configuración silenciosos.
 */
export const nivelBonoSchema = z.object({
  nombre: z
    .string("Escribe el nombre del nivel")
    .trim()
    .min(1, "Requerido")
    .max(60, "Demasiado largo"),
  puntaje_min: porcentaje("Escribe el puntaje desde el que aplica"),
  monto: z
    .number("Escribe el monto del bono")
    .min(0, "No puede ser negativo")
    .max(9_999_999_999, "Demasiado grande"),
});

/**
 * La escalera COMPLETA que se publica de una vez.
 *
 * Publicar reemplaza la anterior entera, así que llega como un conjunto y no
 * como filas sueltas: media escalera publicada sería una escalera vigente.
 */
export const publicarEscaleraBonoSchema = z
  .object({
    tenant_id: z.guid("Elige un cliente"),
    vigente_desde: z.iso.date("Elige desde cuándo rige"),
    niveles: z
      .array(nivelBonoSchema)
      .min(1, "La escalera necesita al menos un nivel")
      .max(10, "Demasiados niveles"),
  })
  .refine(
    (e) =>
      new Set(e.niveles.map((n) => n.puntaje_min)).size === e.niveles.length,
    {
      path: ["niveles"],
      message: "Dos niveles no pueden empezar en el mismo puntaje",
    },
  );

export type PublicarEscaleraBono = z.infer<typeof publicarEscaleraBonoSchema>;
