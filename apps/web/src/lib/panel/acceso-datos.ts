import type { CanalOtp, EstadoPase } from "@market-track/shared";

import { createServerSupabaseClient } from "@/lib/supabase/server";

// La lectura de servidor de la pantalla de acceso.
//
// Separada de `acceso.ts` a propósito: aquel es lógica pura que también usan
// componentes de cliente, y tocar el cliente de Supabase desde allí arrastraría
// la validación de variables de entorno al navegador.

export type DatosAcceso = {
  canales: CanalOtp[];
  pases: {
    id: string;
    usuario_nombre: string | null;
    emisor_nombre: string | null;
    motivo: string;
    estado: EstadoPase;
    generado_at: string;
  }[];
  elegibles: { id: string; nombre: string; dni: string | null }[];
  /** Se distingue de «no hay nada»: un fallo de carga no es un estado vacío. */
  error: string | null;
};

/**
 * Lo que necesita la pantalla de acceso, para admin y para supervisor.
 *
 * Sin filtro de alcance por parámetro: la bitácora la acota la RLS —el admin lo
 * ve todo, el supervisor solo los pases de sus mercaderistas— y los elegibles se
 * acotan igual por la política de `profile`. Elegir el alcance aquí sería una
 * segunda regla que se puede desincronizar de la primera.
 */
export async function datosDeAcceso(): Promise<DatosAcceso> {
  const supabase = await createServerSupabaseClient();

  const [config, bitacora, elegibles] = await Promise.all([
    supabase
      .from("configuracion_plataforma")
      .select("otp_canales_habilitados")
      .eq("id", true)
      .maybeSingle(),
    supabase.rpc("bitacora_pases"),
    supabase
      .from("profile")
      .select("id, nombre, dni")
      .eq("rol", "mercaderista")
      // Un pase para alguien dado de baja no sirve: el acceso es derivado y se
      // le negaría igual al canjearlo.
      .eq("activo", true)
      .order("nombre"),
  ]);

  const fallo = config.error ?? bitacora.error ?? elegibles.error;
  if (fallo) {
    console.error("[acceso] carga", fallo.message.slice(0, 200));
    return {
      canales: ["correo"],
      pases: [],
      elegibles: [],
      error: "No se pudo cargar la configuración de acceso.",
    };
  }

  return {
    canales: config.data?.otp_canales_habilitados ?? ["correo"],
    pases: bitacora.data ?? [],
    elegibles: elegibles.data ?? [],
    error: null,
  };
}
