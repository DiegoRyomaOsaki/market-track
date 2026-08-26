"use server";

import { redirect, RedirectType } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";

import { COOKIE_TENANT } from "@/lib/panel/tenant";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Cerrar sesión desde el panel y desde el portal.
//
// Hasta ahora no existía: se entraba con dos factores y no se salía con ninguno.
// El otro extremo del ciclo de vida de la sesión estaba sin cubrir, y para
// cambiar de usuario en local había que borrar la fila de `auth.sessions` a mano.
//
// (Ojo con el eco de nombres: `lib/panel/sesion.ts` responde *quién llama* y es
// el gate del staff. Esto es otra cosa — destruir la sesión del que llama — y
// ninguno de los dos extiende al otro.)

/**
 * Cuánto se espera al proveedor de auth antes de cerrar por nuestra cuenta.
 *
 * El SDK no admite un `AbortSignal` en `signOut`, y su default de red pasa de
 * los 30 s: sin este techo, un Auth server colgado dejaría al usuario mirando un
 * botón que no responde justo cuando lo que quiere es irse.
 */
const DEADLINE_MS = 8_000;

/**
 * El cuerpo no se lee: esta acción no toma ni un dato del cliente. Lo que se
 * valida es la FORMA de la invocación, que es lo único que hay que validar —
 * una Server Action es un endpoint POST alcanzable, y aceptar argumentos
 * arbitrarios sin decir que se ignoran invita a que mañana alguien los lea.
 *
 * La autoridad aquí es la COOKIE de sesión, no el cuerpo: si no hay sesión, la
 * acción termina igual en `/login`. Y no lleva gate de rol a propósito —
 * destruir la propia sesión lo puede hacer cualquiera que tenga una.
 */
const cuerpoSchema = z.instanceof(FormData);

/** Las cookies de sesión de `@supabase/ssr`, incluidos sus trozos (`nombre.0`). */
function esCookieDeSesion(nombre: string): boolean {
  return /^sb-.*-auth-token(\.\d+)?$/.test(nombre);
}

/**
 * Cierra la sesión y manda a `/login`.
 *
 * **El scope es `global`, y esa fue una decisión, no un default.** `local`
 * cerraría solo este navegador, y entonces el caso que motiva todo esto —el
 * portátil prestado o robado, el equipo compartido, la demo en casa del
 * cliente— seguiría sin solución: no se puede pulsar un botón en una máquina
 * que ya no se tiene. Con `global` se entra desde otro sitio y se cierra todo.
 *
 * El coste habitual de `global` —echar al usuario de su teléfono— **aquí no
 * existe**: `profile.rol` es de un solo valor y el CHECK
 * `profile_tenant_segun_rol` impide que un `admin`, `supervisor` o `cliente`
 * sea además `mercaderista`, así que quien usa el panel o el portal nunca tiene
 * sesión en la app móvil. Lo que sí corta son sus otras sesiones de navegador,
 * y para una herramienta de trabajo con 2FA eso pesa menos que dejar viva una
 * sesión en un equipo que ya no se controla.
 */
export async function cerrarSesion(datos: unknown): Promise<never> {
  if (!cuerpoSchema.safeParse(datos).success) {
    // Nada que cerrar y nada que explicar: a la pantalla de acceso.
    redirect("/login", RedirectType.replace);
  }

  const cookieStore = await cookies();
  const supabase = await createServerSupabaseClient();

  // Solo para la traza. NO es autorización: quien no tenga sesión acaba en
  // `/login` igual, por el camino de abajo.
  const { data } = await supabase.auth.getSession();
  const usuario = data.session?.user.id ?? "sin-sesion";

  let degradado: string | null = null;
  try {
    const resultado = await Promise.race([
      supabase.auth.signOut({ scope: "global" }),
      new Promise<never>((_, rechazar) =>
        setTimeout(() => rechazar(new Error("timeout")), DEADLINE_MS),
      ),
    ]);
    if (resultado.error) degradado = resultado.error.message;
  } catch (error) {
    degradado = error instanceof Error ? error.message : String(error);
  }

  if (degradado === null) {
    console.info(`[sesion] sesion_cerrada usuario=${usuario} scope=global`);
  } else {
    // El borrado de respaldo NO es cinturón y tirantes. Cuando `signOut` falla
    // al resolver la sesión local, auth-js devuelve el error y **no la borra**:
    // sin esto, un fallo del Auth server produce un "Salir" que deja la sesión
    // viva — y en silencio, que es lo peor de las dos cosas.
    console.error(
      `[sesion] cierre_sesion_degradado usuario=${usuario} motivo=${degradado.slice(0, 200)}`,
    );
    for (const { name } of cookieStore.getAll()) {
      if (esCookieDeSesion(name)) cookieStore.delete(name);
    }
  }

  // El cliente-marca que estaba mirando el anterior no se hereda. No es un
  // agujero —la RLS acota por perfil, no por esta cookie— pero el portátil
  // compartido es exactamente el escenario que motiva este ticket, y encontrarse
  // la vista de otro al entrar es desconcertante.
  cookieStore.delete(COOKIE_TENANT);

  // `replace` y no el `push` por defecto: sustituye la entrada de la que se
  // sale, así que el "atrás" inmediato ya no apunta a la pantalla que se acaba
  // de cerrar. La caché del router la invalida por su cuenta la mutación de
  // cookies de arriba; esto ataca el historial, que es lo que aquella no cubre.
  redirect("/login", RedirectType.replace);
}
