import { z } from "zod";

import {
  ambitoFormularioSchema,
  definicionFormularioSchema,
  tipoCampoFormularioSchema,
  TOPES_FORMULARIO,
} from "@market-track/shared";

// Validación en la frontera del constructor de formularios (MAR-79, ADR-0010).
// El formulario tiene dos tablas: la CABECERA (`formulario_levantamiento`) y sus
// VERSIONES (`formulario_version`, con la `definicion` jsonb). Aquí viven:
//
//   - el alta de la cabecera,
//   - el guardado de un BORRADOR (definición LENIENTE: se guarda a medio editar,
//     con etiquetas vacías o pasos sin campos),
//   - la publicación (definición ESTRICTA: reutiliza el esquema canónico de
//     `packages/shared`, que exige etiquetas, opciones y al menos un paso).
//
// La versión estricta la publica el móvil; la leniente nunca sale del panel (el
// stream solo replica `publicada = true`).

const nombre = z
  .string()
  .trim()
  .min(1, "Requerido")
  .max(TOPES_FORMULARIO.etiquetaChars, "Demasiado largo");

/** Marca opcional: "" o ausente significa "todas las marcas del cliente" → null. */
const marcaOpcional = z
  .union([z.literal(""), z.guid("Marca inválida")])
  .optional()
  .transform((v) => (v == null || v === "" ? null : v));

export const altaFormularioSchema = z
  .object({
    nombre,
    tenant_id: z.guid("Elige un cliente"),
    marca_id: marcaOpcional,
    // Ausente en el alta clásica: el único ámbito que existía era el wizard.
    ambito: ambitoFormularioSchema.default("levantamiento"),
  })
  .refine((v) => v.ambito === "levantamiento" || v.marca_id === null, {
    message: "Un formulario de check-in es de la visita, no de una marca",
    path: ["marca_id"],
  });

export type AltaFormulario = z.infer<typeof altaFormularioSchema>;

// La definición LENIENTE: misma forma que la canónica, pero sin los mínimos que
// impedirían guardar un trabajo en curso. El tipo de campo sí se valida contra
// el enum compartido (única fuente de los tipos).
// Los TOPES de tamaño sí se aplican al borrador: son lo que impide que una fila
// crezca sin límite, y eso no depende de si el trabajo está terminado. Lo que el
// borrador relaja son los MÍNIMOS (etiquetas vacías, pasos sin campos) y la
// coherencia del rango — el admin puede teclear el máximo antes que el mínimo.
const campoBorradorSchema = z.object({
  id: z.string().min(1).max(TOPES_FORMULARIO.idChars),
  tipo: tipoCampoFormularioSchema,
  etiqueta: z.string().max(TOPES_FORMULARIO.etiquetaChars),
  obligatorio: z.boolean().default(false),
  ayuda: z.string().max(TOPES_FORMULARIO.ayudaChars).optional(),
  opciones: z
    .array(z.string().max(TOPES_FORMULARIO.opcionChars))
    .max(TOPES_FORMULARIO.opcionesPorCampo)
    .optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

const pasoBorradorSchema = z.object({
  id: z.string().min(1).max(TOPES_FORMULARIO.idChars),
  titulo: z.string().max(TOPES_FORMULARIO.etiquetaChars),
  orden: z.number().int().nonnegative(),
  campos: z.array(campoBorradorSchema).max(TOPES_FORMULARIO.camposPorPaso),
});

export const borradorDefinicionSchema = z.object({
  pasos: z.array(pasoBorradorSchema).max(TOPES_FORMULARIO.pasos),
});

export type DefinicionBorrador = z.infer<typeof borradorDefinicionSchema>;

export const guardarBorradorSchema = z.object({
  nombre,
  activo: z.boolean().default(true),
  definicion: borradorDefinicionSchema,
});

export type GuardarBorrador = z.infer<typeof guardarBorradorSchema>;

// Publicar exige la definición ESTRICTA: un formulario inválido no puede quedar
// congelado e irse al teléfono. Es la misma verja que corre en el cliente antes
// de habilitar el botón; aquí es el portero que no depende del navegador.
//
// "La misma verja" hay que sostenerlo, no solo escribirlo: durante un tiempo el
// esquema estricto NO comprobaba `min <= max` y el constructor sí, así que una
// llamada que no pasara por el botón publicaba un rango imposible. Si se añade
// una regla a `problemasDeDefinicion`, tiene que existir aquí.
export const publicarSchema = z.object({
  nombre,
  activo: z.boolean().default(true),
  definicion: definicionFormularioSchema,
});
