import { z } from "zod";

// La DEFINICIÓN de un formulario de levantamiento configurable (ADR-0010, MAR-73).
// Es lo que el panel ESCRIBE y el móvil LEE: la presentación y los campos LIBRES
// de cada paso. Los pasos con lógica de negocio (SOS, quiebres, precios) y sus
// campos derivados NO viven aquí — los pone la base. El formulario los presenta y
// añade campos extra; no reescribe sus reglas.
//
// La columna es `jsonb`: su integridad la sostiene Zod, no el tipo de Postgres.
// Por eso se valida en cada frontera (al publicar en el panel, al leer en el móvil).

export const tipoCampoFormularioSchema = z.enum([
  "texto",
  "parrafo",
  "entero",
  "decimal",
  "booleano",
  "seleccion",
  "seleccion_multiple",
  "foto",
]);

export const campoFormularioSchema = z
  .object({
    // Clave ESTABLE del campo: es la que ancla la respuesta. No se renombra.
    id: z.string().min(1),
    tipo: tipoCampoFormularioSchema,
    etiqueta: z.string().min(1),
    obligatorio: z.boolean().default(false),
    ayuda: z.string().optional(),
    // Solo para selección: las opciones elegibles.
    opciones: z.array(z.string().min(1)).optional(),
    // Solo para número: el rango válido.
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .refine(
    (c) =>
      !c.tipo.startsWith("seleccion") ||
      (c.opciones != null && c.opciones.length > 0),
    { message: "Un campo de selección necesita al menos una opción" },
  );

export const pasoFormularioSchema = z.object({
  id: z.string().min(1),
  titulo: z.string().min(1),
  orden: z.number().int().nonnegative(),
  campos: z.array(campoFormularioSchema),
});

export const definicionFormularioSchema = z
  .object({
    pasos: z.array(pasoFormularioSchema).min(1),
  })
  .refine(
    (d) => {
      const ids = d.pasos.flatMap((p) => p.campos.map((c) => c.id));
      return new Set(ids).size === ids.length;
    },
    { message: "Los id de campo deben ser únicos en todo el formulario" },
  );

export type TipoCampoFormulario = z.infer<typeof tipoCampoFormularioSchema>;
export type CampoFormulario = z.infer<typeof campoFormularioSchema>;
export type PasoFormulario = z.infer<typeof pasoFormularioSchema>;
export type DefinicionFormulario = z.infer<typeof definicionFormularioSchema>;
