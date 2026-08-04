import { createServerSupabaseClient } from "@/lib/supabase/server";

// Quién llama a una server action del panel.
//
// Una server action es un endpoint POST: no la protege que el botón que la
// dispara solo se pinte en `/supervisor`. Cualquiera con sesión puede invocarla
// directamente, así que el rol se comprueba aquí, antes de tocar nada.
//
// Un solo dueño de la pregunta a propósito. Las tres primeras pantallas del panel
// resolvieron el rol cada una por su cuenta y las tres copiaron el mismo fallo:
// `select('rol').maybeSingle()` SIN filtrar por el id del usuario. `profile` deja
// al staff leer todas las filas (`profile_staff_lee_todo`), así que esa consulta
// devuelve la tabla entera, `maybeSingle()` la rechaza por traer más de una fila
// y el gate concluye "no es staff" — justo para las dos únicas personas que sí lo
// son. Fallaba cerrado, que es lo único bueno que se puede decir.

const ROLES_STAFF = ["admin", "supervisor"] as const;

type RolStaff = (typeof ROLES_STAFF)[number];

function esRolStaff(rol: string | null | undefined): rol is RolStaff {
  return ROLES_STAFF.some((r) => r === rol);
}

export type SesionStaff = {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  perfil: { id: string; rol: RolStaff; nombre: string };
};

/**
 * La sesión de quien llama, solo si es staff: el cliente de Supabase de la
 * petición y su perfil. `null` en cualquier otro caso — sin sesión, con rol de
 * cliente o mercaderista, o si la consulta del perfil falla.
 *
 * Devuelve las dos cosas juntas porque quien pasa el gate casi siempre necesita
 * las dos: el cliente para escribir y el perfil para dejar constancia de quién
 * resolvió qué.
 */
export async function sesionDeStaff(): Promise<SesionStaff | null> {
  const supabase = await createServerSupabaseClient();

  const { data: sesion, error: errorSesion } = await supabase.auth.getUser();
  if (errorSesion || !sesion.user) return null;

  const { data: perfil, error } = await supabase
    .from("profile")
    .select("id, rol, nombre")
    // El filtro no es cosmético: sin él la consulta devuelve todos los perfiles
    // que la RLS le deja ver al staff, y `maybeSingle()` falla por multiplicidad.
    .eq("id", sesion.user.id)
    .maybeSingle();

  if (error) {
    console.error("[panel] no se pudo resolver el perfil", error.message);
    return null;
  }
  if (!perfil || !esRolStaff(perfil.rol)) return null;

  return { supabase, perfil: { ...perfil, rol: perfil.rol } };
}
