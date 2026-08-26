import { createServerSupabaseClient } from "@/lib/supabase/server";

// Quién llama a un endpoint del portal.
//
// El route handler que sirve el Excel es un GET alcanzable por cualquiera con
// sesión: no lo protege que el enlace solo se pinte en `/cliente`. El middleware
// cubre la navegación, pero un route handler es un endpoint por sí mismo y su
// comprobación de rol vive aquí — el mismo razonamiento que ya está escrito en
// `admin/importar/plantilla/route.ts`.
//
// Es el gemelo de `sesionDeStaff`, y copia deliberadamente su detalle más
// importante: el `.eq("id", …)`. Sin él, la consulta devuelve todas las filas de
// `profile` que la RLS le deje ver a quien llama, `maybeSingle()` la rechaza por
// multiplicidad y el gate concluye lo contrario de lo que debía. Tres pantallas
// del panel pisaron ese fallo antes de que existiera un solo dueño de la
// pregunta.

export type SesionCliente = {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  perfil: { id: string; nombre: string };
};

/**
 * La sesión de quien llama, solo si es un usuario cliente-marca. `null` en
 * cualquier otro caso — sin sesión, con rol de staff o de mercaderista, o si la
 * consulta del perfil falla.
 *
 * Falla cerrado: un error leyendo el perfil devuelve `null`, nunca una sesión a
 * medias.
 */
export async function sesionDeCliente(): Promise<SesionCliente | null> {
  const supabase = await createServerSupabaseClient();

  const { data: sesion, error: errorSesion } = await supabase.auth.getUser();
  if (errorSesion || !sesion.user) return null;

  const { data: perfil, error } = await supabase
    .from("profile")
    .select("id, rol, nombre")
    .eq("id", sesion.user.id)
    .maybeSingle();

  if (error) {
    console.error(
      JSON.stringify({
        evento: "portal_sesion_error",
        detalle: error.message.slice(0, 200),
      }),
    );
    return null;
  }
  if (!perfil || perfil.rol !== "cliente") return null;

  return { supabase, perfil: { id: perfil.id, nombre: perfil.nombre } };
}
