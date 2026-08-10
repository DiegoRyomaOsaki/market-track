import { cookies } from "next/headers";

import { COOKIE_TENANT, type Tenant } from "@/lib/panel/tenant";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// El cliente-marca activo, resuelto en el servidor.
//
// Vive en su propio módulo y no dentro de la pantalla porque es la decisión de
// más riesgo del importador —contra qué cliente se escribe el maestro— y así se
// puede probar sin montar React. `tenant.ts` no vale de casa: lo importa el
// selector, que es un componente cliente, y `next/headers` no existe allí.

/**
 * El tenant elegido, o `null` si no hay ninguno activo o la consulta falla.
 *
 * La cookie la escribe el navegador: vale como preferencia, no como autoridad.
 * Buscarla dentro de la lista que la RLS devolvió es lo que la valida — un id
 * inventado no selecciona nada y se cae al primero, nunca a un cliente ajeno.
 */
export async function tenantActivo(): Promise<Tenant | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tenant")
    .select("id, nombre")
    .eq("activo", true)
    .order("nombre");

  if (error) {
    console.error("[panel] tenants", error.message.slice(0, 200));
    return null;
  }

  const tenants: Tenant[] = data ?? [];
  const elegido = (await cookies()).get(COOKIE_TENANT)?.value;
  return tenants.find((t) => t.id === elegido) ?? tenants[0] ?? null;
}
