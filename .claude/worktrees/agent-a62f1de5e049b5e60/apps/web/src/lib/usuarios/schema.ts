import { rolUsuarioSchema } from "@market-track/shared";
import { z } from "zod";

// Validación del alta de usuario en la frontera del formulario. Espeja el contrato
// de la Edge Function `crear-usuario` (que tiene su propia copia en Deno, fuera del
// workspace): staff sin tenant; cliente/mercaderista con tenant; el mercaderista
// con supervisor. Es la única copia de esta forma en el lado web.
export const altaUsuarioSchema = z
  .object({
    email: z.email("Correo inválido"),
    password: z.string().min(8, "Mínimo 8 caracteres"),
    nombre: z.string().trim().min(1, "Requerido"),
    dni: z.string().trim().min(1, "Requerido"),
    rol: rolUsuarioSchema,
    tenant_id: z.union([z.guid(), z.literal("")]).optional(),
    supervisor_id: z.union([z.guid(), z.literal("")]).optional(),
    telefono: z.string().trim().optional(),
  })
  .refine(
    (u) =>
      u.rol === "admin" || u.rol === "supervisor"
        ? !u.tenant_id
        : !!u.tenant_id,
    {
      message:
        "El staff no lleva cliente-marca; el cliente y el mercaderista sí.",
      path: ["tenant_id"],
    },
  )
  .refine((u) => u.rol !== "mercaderista" || !!u.supervisor_id, {
    message: "Un mercaderista necesita un supervisor.",
    path: ["supervisor_id"],
  });

export type AltaUsuario = z.infer<typeof altaUsuarioSchema>;

/** Payload que espera la Edge Function: sin cadenas vacías, con nulls explícitos. */
export function aPayloadCrearUsuario(datos: AltaUsuario) {
  return {
    email: datos.email,
    password: datos.password,
    nombre: datos.nombre,
    dni: datos.dni,
    rol: datos.rol,
    tenant_id: datos.tenant_id ? datos.tenant_id : null,
    supervisor_id: datos.supervisor_id ? datos.supervisor_id : null,
    telefono: datos.telefono ? datos.telefono : null,
  };
}
