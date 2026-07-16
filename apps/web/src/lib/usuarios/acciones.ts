"use server";

import { revalidatePath } from "next/cache";

import { env } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { aPayloadCrearUsuario, altaUsuarioSchema } from "./schema";

const FUNCION_TIMEOUT_MS = 10_000;

export type ResultadoAccion =
  { ok: true } | { ok: false; error: string; detalles?: unknown };

/**
 * Alta de usuario: valida en el servidor y delega en la Edge Function
 * `crear-usuario`, que corre con service_role y es la única que puede tocar
 * `auth.users`. Se reenvía el JWT del admin llamante para que la función haga su
 * propia autorización (solo un admin crea usuarios).
 */
export async function crearUsuario(datos: unknown): Promise<ResultadoAccion> {
  const parsed = altaUsuarioSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos inválidos",
      detalles: parsed.error.issues,
    };
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: "No autenticado" };

  let res: Response;
  try {
    res = await fetch(`${env.SUPABASE_URL}/functions/v1/crear-usuario`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: env.SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(aPayloadCrearUsuario(parsed.data)),
      signal: AbortSignal.timeout(FUNCION_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(
      "[usuarios] fallo al llamar crear-usuario",
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false, error: "No se pudo contactar el servicio de alta" };
  }

  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    return { ok: false, error: cuerpo?.error ?? `Error ${res.status}` };
  }

  revalidatePath("/admin/usuarios");
  return { ok: true };
}

/**
 * Baja de un cliente-marca: apaga `tenant.activo`. El acceso de sus mercaderistas
 * es DERIVADO (`app.perfil_efectivo()`), así que se revoca solo — no se toca
 * `profile.activo`, para que al reactivar el cliente no vuelva el desvinculado
 * individualmente. La RLS solo deja hacerlo a un admin.
 */
export async function desactivarCliente(
  tenantId: string,
): Promise<ResultadoAccion> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("tenant")
    .update({ activo: false })
    .eq("id", tenantId);
  if (error) {
    console.error(
      "[usuarios] fallo baja de cliente",
      error.message.slice(0, 200),
    );
    return { ok: false, error: "No se pudo dar de baja al cliente" };
  }
  revalidatePath("/admin/usuarios");
  return { ok: true };
}
