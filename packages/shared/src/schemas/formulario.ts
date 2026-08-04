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

// Topes de tamaño. Una definición publicada se REPLICA A CADA TELÉFONO, así que
// su tamaño no es solo una cuestión de cordura: es ancho de banda y disco en un
// gama media que sincroniza por datos móviles. Son límites holgados para
// cualquier formulario real —el wizard de levantamiento completo no llega a diez
// pasos— y su función es que un error o un abuso no cueste una réplica enorme.
export const TOPES_FORMULARIO = {
  pasos: 20,
  camposPorPaso: 50,
  opcionesPorCampo: 100,
  idChars: 64,
  etiquetaChars: 120,
  ayudaChars: 500,
  opcionChars: 120,
  // Los topes de arriba acotan cada pieza, pero multiplicados dan un peor caso
  // de varios MB — muy por encima de lo que tiene sentido replicar a un teléfono
  // por datos móviles. Este es el techo que de verdad importa; los otros evitan
  // que una sola pieza se desmadre. Un formulario real no pasa de unos pocos KB.
  bytesTotal: 256 * 1024,
} as const;

export const campoFormularioSchema = z
  .object({
    // Clave ESTABLE del campo: es la que ancla la respuesta. No se renombra.
    id: z.string().min(1).max(TOPES_FORMULARIO.idChars),
    tipo: tipoCampoFormularioSchema,
    etiqueta: z.string().min(1).max(TOPES_FORMULARIO.etiquetaChars),
    obligatorio: z.boolean().default(false),
    ayuda: z.string().max(TOPES_FORMULARIO.ayudaChars).optional(),
    // Solo para selección: las opciones elegibles.
    opciones: z
      .array(z.string().min(1).max(TOPES_FORMULARIO.opcionChars))
      .max(TOPES_FORMULARIO.opcionesPorCampo)
      .optional(),
    // Solo para número: el rango válido.
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .refine(
    (c) =>
      !c.tipo.startsWith("seleccion") ||
      (c.opciones != null && c.opciones.length > 0),
    { message: "Un campo de selección necesita al menos una opción" },
  )
  // Un rango invertido no es solo raro: es IMPOSIBLE de satisfacer, y el móvil
  // lo resuelve mal. `clamp` aplica el mínimo primero, así que con {min:10,max:5}
  // una respuesta de 3 se guarda como 10 — por encima del máximo que declara el
  // propio campo. La verja tiene que estar aquí, porque la del constructor solo
  // apaga un botón y no protege a quien llame a `publicarFormulario` por otra vía.
  .refine((c) => c.min == null || c.max == null || c.min <= c.max, {
    message: "El mínimo no puede ser mayor que el máximo",
    path: ["min"],
  });

export const pasoFormularioSchema = z.object({
  id: z.string().min(1).max(TOPES_FORMULARIO.idChars),
  titulo: z.string().min(1).max(TOPES_FORMULARIO.etiquetaChars),
  orden: z.number().int().nonnegative(),
  campos: z.array(campoFormularioSchema).max(TOPES_FORMULARIO.camposPorPaso),
});

/**
 * Bytes que ocupa la cadena en UTF-8. Se cuenta a mano y no con `TextEncoder`
 * porque este paquete es isomorfo (web, móvil y Deno) y no puede dar por hecho
 * el DOM. Se cuenta en BYTES, no en caracteres, para medir lo mismo que el
 * `check` de `formulario_version`: en español un solo acento ya son dos.
 */
function bytesUtf8(texto: string): number {
  let bytes = 0;
  for (const caracter of texto) {
    const punto = caracter.codePointAt(0) ?? 0;
    if (punto < 0x80) bytes += 1;
    else if (punto < 0x800) bytes += 2;
    else if (punto < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

/** El peso real de la definición ya serializada, que es como viaja y se guarda. */
export function excedeTamano(definicion: unknown): boolean {
  return bytesUtf8(JSON.stringify(definicion)) > TOPES_FORMULARIO.bytesTotal;
}

export const definicionFormularioSchema = z
  .object({
    pasos: z.array(pasoFormularioSchema).min(1).max(TOPES_FORMULARIO.pasos),
  })
  .refine(
    (d) => {
      const ids = d.pasos.flatMap((p) => p.campos.map((c) => c.id));
      return new Set(ids).size === ids.length;
    },
    { message: "Los id de campo deben ser únicos en todo el formulario" },
  )
  .refine((d) => !excedeTamano(d), {
    message: "El formulario es demasiado grande para sincronizarse al teléfono",
  });

export type TipoCampoFormulario = z.infer<typeof tipoCampoFormularioSchema>;
export type CampoFormulario = z.infer<typeof campoFormularioSchema>;
export type PasoFormulario = z.infer<typeof pasoFormularioSchema>;
export type DefinicionFormulario = z.infer<typeof definicionFormularioSchema>;
