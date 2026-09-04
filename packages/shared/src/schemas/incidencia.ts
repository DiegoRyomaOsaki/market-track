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

/**
 * Las acciones que el mercaderista suele tomar, para no teclearlas de cero.
 *
 * Son FRASES, no códigos. Al elegir una, el texto entra editable en el campo y
 * puede afinarla o borrarla — que es el "texto libre cuando se sale de las
 * opciones" del acuerdo. Guardar un código aparte obligaría a una segunda
 * columna para el texto libre, o a un centinela que el panel tendría que
 * interpretar; y un valor tipificado que crezca dejaría a las filas viejas
 * cayendo en un `default` que traga la deriva.
 *
 * Lo que se pierde: agregar "cuántas se resolvieron cambiando el precio". Ningún
 * criterio lo pide hoy, y retrofitear códigos sobre texto libre ya escrito sería
 * una migración de datos.
 */
export const ACCIONES_TOMADAS = [
  "Cambié el precio en góndola",
  "Hablé con el encargado y lo corrigió",
  "Repuse el producto desde trastienda",
  "Instalé el material y quedó completo",
] as const;

/**
 * Los números del hallazgo que el motor guardó en `incidencia.detalle`.
 *
 * LAXO a propósito: todo opcional y `.catch({})` al final. El motor puede añadir
 * una clave —ya lo hizo con `delta`— y una unión estricta por origen convertiría
 * eso en un teléfono con una versión vieja de la app que revienta al pintar la
 * lista. Se pinta lo que haya; no se recalcula nada (para eso está el motor).
 */
export const detalleIncidenciaSchema = z
  .object({
    stock_sistema: z.number().nullish(),
    stock_piso: z.number().nullish(),
    delta: z.number().nullish(),
    precio_registrado: z.number().nullish(),
    precio_regular: z.number().nullish(),
    motivo: z.string().nullish(),
    exhibicion_id: z.string().nullish(),
    unidades: z.number().nullish(),
  })
  .loose()
  .catch({});

export type DetalleIncidencia = z.infer<typeof detalleIncidenciaSchema>;
