import type { CanalOtp, EstadoPase } from "@market-track/shared";

import { type SesionStaff, sesionDeStaff } from "@/lib/panel/sesion";

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
 * La bitácora la acota la RLS: el admin la ve entera, el supervisor solo los
 * pases de sus mercaderistas.
 *
 * La lista de elegibles NO se puede dejar a la RLS: `profile_staff_lee_todo` deja
 * a cualquier staff leer toda la plantilla, así que un supervisor vería el nombre
 * y el DNI de los mercaderistas de otros supervisores —y de otros clientes— solo
 * por abrir esta pantalla. Emitirles un pase le fallaría, pero el dato personal ya
 * se le habría enseñado. Se acota aquí, y por eso hace falta saber quién llama.
 */
export async function datosDeAcceso(): Promise<DatosAcceso> {
  const sesion = await sesionDeStaff();
  if (sesion === null) {
    return {
      canales: ["correo"],
      pases: [],
      elegibles: [],
      error: "No se pudo cargar la configuración de acceso.",
    };
  }
  const { supabase, perfil } = sesion;

  const [config, bitacora, elegibles] = await Promise.all([
    supabase
      .from("configuracion_plataforma")
      .select("otp_canales_habilitados")
      .eq("id", true)
      .maybeSingle(),
    supabase.rpc("bitacora_pases"),
    elegiblesDe(supabase, perfil).order("nombre"),
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

/**
 * A quién se le puede emitir un pase: mercaderistas activos, y —si quien mira no
 * es admin— solo los de su propio equipo.
 *
 * Un pase para alguien dado de baja no sirve: el acceso es derivado y se le
 * negaría igual al canjearlo.
 */
function elegiblesDe(
  supabase: SesionStaff["supabase"],
  perfil: SesionStaff["perfil"],
) {
  const consulta = supabase
    .from("profile")
    .select("id, nombre, dni")
    .eq("rol", "mercaderista")
    .eq("activo", true);

  return perfil.rol === "admin"
    ? consulta
    : consulta.eq("supervisor_id", perfil.id);
}
