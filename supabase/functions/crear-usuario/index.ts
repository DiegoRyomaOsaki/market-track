// Alta de usuarios. La creación es de DOS pasos —`auth.users` (admin API) +
// `public.profile`— y debe ser atómica: si el segundo falla, se deshace el
// primero. Solo un admin puede llamarla. El SERVICE_ROLE_KEY vive aquí, nunca
// en el cliente.
//
// La validación del payload vive en esta frontera (Zod). Se define local y no en
// packages/shared porque las Edge Functions corren en Deno y no consumen el
// workspace de pnpm; es la única copia de esta forma.

import { z } from "npm:zod@4";

import {
  clienteDelLlamante,
  clienteServicio,
  json,
} from "../_shared/supabase.ts";

const rolUsuario = z.enum(["admin", "supervisor", "cliente", "mercaderista"]);

const crearUsuarioSchema = z
  .object({
    email: z.email(),
    password: z.string().min(8),
    nombre: z.string().min(1),
    dni: z.string().min(1),
    rol: rolUsuario,
    tenant_id: z.guid().nullish(),
    supervisor_id: z.guid().nullish(),
    telefono: z.string().nullish(),
  })
  // Las mismas reglas que el CHECK del modelo: el staff no pertenece a ningún
  // cliente; el cliente y el mercaderista sí; el mercaderista tiene supervisor.
  .refine(
    (u) =>
      u.rol === "admin" || u.rol === "supervisor"
        ? u.tenant_id == null
        : u.tenant_id != null,
    {
      message: "staff sin tenant; cliente/mercaderista con tenant",
      path: ["tenant_id"],
    },
  )
  .refine((u) => u.rol !== "mercaderista" || u.supervisor_id != null, {
    message: "un mercaderista necesita supervisor",
    path: ["supervisor_id"],
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "método no permitido" });

  // Frontera: el cuerpo es de un tercero hasta que Zod lo valida.
  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return json(400, { error: "cuerpo no es JSON válido" });
  }
  const parsed = crearUsuarioSchema.safeParse(cuerpo);
  if (!parsed.success) {
    return json(400, {
      error: "payload inválido",
      detalles: parsed.error.issues,
    });
  }
  const datos = parsed.data;

  // Autorización: SIEMPRE en el servidor. Solo un admin da de alta usuarios.
  const llamante = clienteDelLlamante(req);
  const { data: auth } = await llamante.auth.getUser();
  if (!auth.user) return json(401, { error: "no autenticado" });

  const servicio = clienteServicio();
  const { data: perfilLlamante } = await servicio
    .from("profile")
    .select("rol")
    .eq("id", auth.user.id)
    .single();
  if (perfilLlamante?.rol !== "admin") {
    return json(403, { error: "solo un admin puede crear usuarios" });
  }

  // Paso 1: crear el usuario de auth (con el correo confirmado para el piloto).
  const { data: creado, error: errAuth } = await servicio.auth.admin.createUser(
    {
      email: datos.email,
      password: datos.password,
      email_confirm: true,
    },
  );
  if (errAuth || !creado.user) {
    return json(400, {
      error: "no se pudo crear el usuario",
      detalle: errAuth?.message,
    });
  }

  // Paso 2: el perfil. Si falla, se DESHACE el paso 1 (compensación aislada).
  const { error: errPerfil } = await servicio.from("profile").insert({
    id: creado.user.id,
    rol: datos.rol,
    tenant_id: datos.tenant_id ?? null,
    supervisor_id: datos.supervisor_id ?? null,
    nombre: datos.nombre,
    dni: datos.dni,
    telefono: datos.telefono ?? null,
  });
  if (errPerfil) {
    try {
      await servicio.auth.admin.deleteUser(creado.user.id);
    } catch (err) {
      // La compensación no debe enmascarar el error original ni el status.
      console.error(
        "fallo al deshacer el usuario huérfano",
        creado.user.id,
        err instanceof Error ? err.message : String(err),
      );
    }
    return json(400, {
      error: "no se pudo crear el perfil",
      detalle: errPerfil.message,
    });
  }

  return json(201, { id: creado.user.id });
});
