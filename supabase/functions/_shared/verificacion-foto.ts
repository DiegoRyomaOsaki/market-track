// Lógica PURA de la verificación de fotos contra R2, separada del handler de
// `fotos-verificar` para probarla con `deno test supabase/functions` sin red.
//
// Qué certifica el sello: que EXISTE un objeto en R2 bajo la key de esa foto.
// Cierra la falsificación barata —una fila `foto` sin un solo byte subido—, no el
// contenido de la imagen. Ese es el contrato; nada aquí lo estira.

import { z } from "npm:zod@4";

// Tope del lote de un barrido: acota el fan-out de HEADs de una sola llamada. La
// SQL lo vuelve a acotar con `least()`, por si el cuerpo llegara sin pasar por
// aquí.
export const TOPE_BARRIDO = 500;
export const LIMITE_BARRIDO_DEFECTO = 100;

// `z.guid()`, no `z.uuid()`: Postgres no impone los bits de versión (ver r2.ts).
export const peticionVerificacionSchema = z.discriminatedUnion("modo", [
  z.object({ modo: z.literal("una"), foto_id: z.guid() }),
  z.object({
    modo: z.literal("barrer"),
    limite: z.number().int().min(1).max(TOPE_BARRIDO).optional(),
  }),
]);

export type PeticionVerificacion = z.infer<typeof peticionVerificacionSchema>;

/**
 * Qué hacer con la respuesta del HEAD. Tres salidas y ninguna destructiva:
 *
 *   sellar        — el objeto existe (200) y no está vacío: se estampa
 *                   `verificada_at`. Si R2 no informó el tamaño se sella igual
 *                   (existencia probada; `bytes_r2` queda null).
 *   no_encontrada — R2 dice que no está (404) o el objeto tiene 0 bytes: NO se
 *                   sella. Es la rama "confirmado que no", que se distingue a
 *                   propósito de la siguiente.
 *   reintentar    — 403 (firma, reloj, credenciales rotadas), 5xx, timeout, red:
 *                   no se sabe. NO se sella y el barrido volverá a preguntar. Una
 *                   caída de R2 nunca es evidencia de fraude.
 */
export type Decision = "sellar" | "no_encontrada" | "reintentar";

export function decidirVerificacion(
  estado: number,
  bytes: number | null,
): Decision {
  if (estado === 200) return bytes === 0 ? "no_encontrada" : "sellar";
  if (estado === 404) return "no_encontrada";
  return "reintentar";
}
