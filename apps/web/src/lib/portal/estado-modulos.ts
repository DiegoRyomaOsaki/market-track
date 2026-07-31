import { type ModuloPortal, moduloPortalSchema } from "@market-track/shared";
import { notFound } from "next/navigation";
import { cache } from "react";

import { createServerSupabaseClient } from "@/lib/supabase/server";

// Qué módulos del portal tiene habilitados el cliente ACTUAL (MAR-54), leídos del
// contrato `public.portal_modulos()` (MAR-74). Cacheado por request (`cache`) para
// no repetir el rpc entre el layout (nav) y el guard de cada página.

export type EstadoModulos = Record<ModuloPortal, boolean>;

function todosHabilitados(): EstadoModulos {
  const estado = {} as EstadoModulos;
  for (const modulo of moduloPortalSchema.options) estado[modulo] = true;
  return estado;
}

export const modulosDelCliente = cache(async (): Promise<EstadoModulos> => {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("portal_modulos");

  if (error || !data) {
    console.error(
      JSON.stringify({
        evento: "portal_modulos_error",
        detalle: error?.message.slice(0, 200) ?? "sin datos",
      }),
    );
    // Degrada a "todo habilitado": el gating de secciones es UX, no seguridad —
    // la RLS protege los datos igual. Mejor mostrar de más que dejar el portal
    // en blanco por un error transitorio del rpc.
    return todosHabilitados();
  }

  const estado = todosHabilitados();
  for (const fila of data) estado[fila.modulo] = fila.habilitado;
  return estado;
});

/** Corta la ruta (404) si el módulo de la sección no está habilitado: una sección
 * deshabilitada no es accesible por URL, no solo invisible en el nav. */
export async function requerirModulo(modulo: ModuloPortal): Promise<void> {
  const estado = await modulosDelCliente();
  if (!estado[modulo]) notFound();
}
