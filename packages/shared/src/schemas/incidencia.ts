import { z } from "zod";

// La frontera que cruza el móvil al ATENDER una incidencia.
//
// No es un espejo de la fila, y ahí está el punto: omite todo lo que decide el
// servidor —`origen`, `detalle`, `tenant_id`, las FK del hallazgo— porque el
// móvil no puede escribirlo. `authenticated` no tiene INSERT sobre `incidencia`
// y su UPDATE está concedido por columnas; este esquema es la misma frontera
// dicha en TypeScript, para que el error se vea antes de salir del teléfono.
//
// Por qué validar aquí y no dejar que hable la base: un CHECK violado vuelve
// como un 23514, y el conector de PowerSync clasifica ese SQLSTATE como
// permanente y DESCARTA la operación. El mercaderista perdería lo que escribió
// sin ver un solo mensaje.

const instante = z.iso.datetime({ offset: true });
const texto = z.string().trim().max(500);

/**
 * Lo que el móvil sube al atender una incidencia. Nunca la crea: la unión cubre
 * solo los dos estados que el mercaderista puede escribir.
 *
 * `anulada` no está a propósito — ese estado es del motor, para cuando el
 * hallazgo deja de existir porque se corrigió el dato que lo originó. Desde la
 * app sería la forma de vaciar la lista sin atenderla.
 */
export const resolucionIncidenciaSchema = z.discriminatedUnion("estado", [
  z.object({
    estado: z.literal("resuelta"),
    // Resolver exige decir QUÉ se hizo: es la mitad del valor de la lista, y lo
    // que el puntaje condicional leerá para premiar al que corrigió.
    accion_tomada: texto.min(1),
    motivo: texto.optional(),
    foto_resolucion_id: z.guid().nullable().optional(),
    atendida_at: instante,
  }),
  z.object({
    estado: z.literal("no_resuelta"),
    // Y no resolver exige decir POR QUÉ.
    motivo: texto.min(1),
    accion_tomada: texto.optional(),
    foto_resolucion_id: z.guid().nullable().optional(),
    atendida_at: instante,
  }),
]);

export type ResolucionIncidencia = z.infer<typeof resolucionIncidenciaSchema>;
