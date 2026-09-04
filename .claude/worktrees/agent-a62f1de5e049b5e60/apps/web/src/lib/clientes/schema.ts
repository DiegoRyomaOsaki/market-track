import { z } from "zod";

// Validación de los maestros de la sección Clientes-marca en la frontera del
// formulario. `tenant` es el CLIENTE; la marca cuelga de él, y el SKU de la marca.

/** Texto opcional que en la base es NULL cuando no se llena. */
const textoOpcional = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null);

const nombre = z.string().trim().min(1, "Requerido");

/**
 * ¿Cabe en numeric(5,2) sin que la base redondee por su cuenta?
 *
 * Comparar `v * 100 === Math.round(v * 100)` parece lo obvio y está MAL: en coma
 * flotante `1.1 * 100` es 110.00000000000001, así que rechazaría una tolerancia
 * de un solo decimal. Se compara contra un epsilon.
 */
function tieneDosDecimalesComoMucho(v: number): boolean {
  const escalado = v * 100;
  return Math.abs(escalado - Math.round(escalado)) < 1e-9;
}

export const altaClienteSchema = z.object({
  nombre,
  activo: z.boolean().default(true),
});

export type AltaCliente = z.infer<typeof altaClienteSchema>;

export const altaMarcaSchema = z.object({
  nombre,
  tenant_id: z.guid("Elige un cliente"),
  // La tolerancia de desviación de precio vive en la MARCA, no en el cliente
  // (ADR-0007): cada marca tolera una desviación distinta. La columna es
  // numeric(5,2), así que más de 2 decimales se redondearían en silencio al
  // guardar y la UI mostraría un número que nadie escribió.
  tolerancia_precio_pct: z
    .number("Escribe un porcentaje")
    .min(0, "No puede ser negativa")
    .max(100, "No puede pasar de 100%")
    .refine(tieneDosDecimalesComoMucho, { message: "Como mucho 2 decimales" }),
  codigo_externo: textoOpcional,
  activo: z.boolean().default(true),
});

export type AltaMarca = z.infer<typeof altaMarcaSchema>;
