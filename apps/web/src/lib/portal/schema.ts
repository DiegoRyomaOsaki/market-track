import { moduloPortalSchema } from "@market-track/shared";
import { z } from "zod";

// Validación en la frontera de la config de módulos del portal (MAR-81). Las
// claves de `modulos` son los valores del enum `modulo_portal` (MAR-74); el valor,
// habilitado/deshabilitado.

export const guardarModulosSchema = z.object({
  tenant_id: z.guid("Elige un cliente"),
  modulos: z.record(moduloPortalSchema, z.boolean()),
});

export type GuardarModulos = z.infer<typeof guardarModulosSchema>;
