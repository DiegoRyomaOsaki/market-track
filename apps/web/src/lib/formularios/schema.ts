import { z } from "zod";

import {
  definicionFormularioSchema,
  tipoCampoFormularioSchema,
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

const nombre = z.string().trim().min(1, "Requerido");

/** Marca opcional: "" o ausente significa "todas las marcas del cliente" → null. */
const marcaOpcional = z
  .union([z.literal(""), z.guid("Marca inválida")])
  .optional()
  .transform((v) => (v == null || v === "" ? null : v));

export const altaFormularioSchema = z.object({
  nombre,
  tenant_id: z.guid("Elige un cliente"),
  marca_id: marcaOpcional,
});

export type AltaFormulario = z.infer<typeof altaFormularioSchema>;

// La definición LENIENTE: misma forma que la canónica, pero sin los mínimos que
// impedirían guardar un trabajo en curso. El tipo de campo sí se valida contra
// el enum compartido (única fuente de los tipos).
const campoBorradorSchema = z.object({
  id: z.string().min(1),
  tipo: tipoCampoFormularioSchema,
  etiqueta: z.string(),
  obligatorio: z.boolean().default(false),
  ayuda: z.string().optional(),
  opciones: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

const pasoBorradorSchema = z.object({
  id: z.string().min(1),
  titulo: z.string(),
  orden: z.number().int().nonnegative(),
  campos: z.array(campoBorradorSchema),
});

export const borradorDefinicionSchema = z.object({
  pasos: z.array(pasoBorradorSchema),
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
export const publicarSchema = z.object({
  nombre,
  activo: z.boolean().default(true),
  definicion: definicionFormularioSchema,
});
