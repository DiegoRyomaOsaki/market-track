import { z } from "zod";

import {
  estadoLevantamientoSchema,
  tipoFotoSchema,
  TIPOS_FOTO,
} from "../enums";

// La forma del árbol que devuelve `galeria_evidencia`.
//
// Se parsea aunque venga de nuestra propia base, por lo mismo que el detalle de
// visita: `jsonb` llega a TypeScript como `Json`, y sin esto la pantalla se
// escribiría a base de casts. Y la función SQL y esta forma son un contrato entre
// dos archivos que nadie compila juntos: el día que una migración renombre una
// clave, falla en el borde con un mensaje que se entiende.

const uuid = z.guid();
const instante = z.iso.datetime({ offset: true });

/**
 * Los tipos de foto que el portal ofrece filtrar.
 *
 * La SELFIE no está: es la cara de un empleado de la outsourcing, no evidencia
 * de tienda. Quien la excluye de verdad es el SQL — esto solo evita ofrecer en la
 * UI un filtro que la base va a ignorar.
 */
export const TIPOS_FOTO_PORTAL = TIPOS_FOTO.filter((t) => t !== "selfie");

export const tipoFotoPortalSchema = tipoFotoSchema.refine(
  (t) => t !== "selfie",
  "La selfie de check-in no se muestra en el portal",
);

const fotoDePar = z.object({
  id: uuid,
  capturada_at: instante,
  /** Nulo mientras el binario siga en el teléfono: no hay nada que firmar. */
  subida_at: instante.nullable(),
});

const otraFoto = fotoDePar.extend({ tipo: tipoFotoSchema });

const levantamientoConEvidencia = z.object({
  id: uuid,
  marca_nombre: z.string(),
  estado: estadoLevantamientoSchema,
  sos_frentes_propios: z.number().int().nullable(),
  quiebres: z.number().int(),
  // El par vive por MARCA dentro de la visita, no por tienda: una tienda con dos
  // marcas tiene dos pares, en pasillos distintos.
  antes: fotoDePar.nullable(),
  despues: fotoDePar.nullable(),
  otras: z.array(otraFoto),
});

const visitaConEvidencia = z.object({
  id: uuid,
  check_in_at: instante,
  check_out_at: instante.nullable(),
  levantamientos: z.array(levantamientoConEvidencia),
  /** Las que no cuelgan de una marca: contingencias de la visita. */
  fotos_visita: z.array(otraFoto),
});

const tiendaConEvidencia = z.object({
  id: uuid,
  nombre: z.string(),
  direccion: z.string().nullable(),
  cadena_nombre: z.string(),
  visitas: z.array(visitaConEvidencia),
});

export const galeriaEvidenciaSchema = z.object({
  /** Cuántas visitas hay en la ventana, aunque el tope recorte las que bajan. */
  visitas_totales: z.number().int(),
  /** Si se recortó, se dice: una galería que calla lo que omite miente. */
  truncado: z.boolean(),
  tiendas: z.array(tiendaConEvidencia),
});

export type GaleriaEvidencia = z.infer<typeof galeriaEvidenciaSchema>;
export type TiendaConEvidencia = z.infer<typeof tiendaConEvidencia>;
export type VisitaConEvidencia = z.infer<typeof visitaConEvidencia>;
export type LevantamientoConEvidencia = z.infer<
  typeof levantamientoConEvidencia
>;
export type FotoDePar = z.infer<typeof fotoDePar>;
export type OtraFoto = z.infer<typeof otraFoto>;
