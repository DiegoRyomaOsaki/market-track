"use server";

import { revalidatePath } from "next/cache";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  altaExhibicionSchema,
  altaPrecioRegularSchema,
  altaPromocionSchema,
} from "./schema";

// Alta y edición de los hechos comerciales. Quien autoriza es la RLS: las
// políticas `precio_admin_escribe`, `promo_admin_escribe` y `exhneg_admin_escribe`
// ya existen y exigen rol admin. No se replica ese gate aquí — sería un segundo
// dueño de una regla que ya tiene uno, y el que se quedaría viejo es este.

export type ResultadoAccion =
  { ok: true } | { ok: false; error: string; detalles?: unknown };

const PRECIOS = "/admin/precios";
const EXHIBICIONES = "/admin/exhibiciones";

// Una escritura que la RLS bloquea afecta a 0 filas SIN dar error: por eso toda
// escritura pide `.select()` y comprueba que volvió algo.
const SIN_PERMISO = "No encontrado o sin permiso";

/**
 * El mensaje que ve el operador cuando choca contra una clave natural.
 *
 * Uno por entidad porque la clave es distinta en cada una: decir "ya existe" sin
 * más deja a quien lo lee sin saber qué campo cambiar.
 */
const DUPLICADO = {
  precio_regular:
    "Ya hay un precio para ese SKU y esa cadena desde esa fecha. Cambia la fecha de vigencia o edita el que existe.",
  promocion:
    "Ya hay una promoción de ese SKU que arranca ese día. Cambia la fecha de inicio o edita la que existe.",
  exhibicion_negociada:
    "Ya hay una exhibición de ese tipo para esa marca en esa tienda desde esa fecha. Cambia la fecha de inicio o edita la que existe.",
} as const;

type Tabla = keyof typeof DUPLICADO;

const ENTIDAD: Record<Tabla, string> = {
  precio_regular: "el precio",
  promocion: "la promoción",
  exhibicion_negociada: "la exhibición",
};

/**
 * Traduce los errores de Postgres que son del usuario, no del sistema.
 *
 * `23503` es una FK COMPUESTA `(x_id, tenant_id)`: la base impide colgar un
 * precio del SKU de otro cliente aunque la UI lo intente.
 */
function mensajeDe(codigo: string | undefined, tabla: Tabla): string {
  if (codigo === "23505") return DUPLICADO[tabla];
  if (codigo === "23503")
    return "Ese SKU, tienda o marca no es de este cliente";
  return `No se pudo guardar ${ENTIDAD[tabla]}`;
}

/** Lo que devuelve PostgREST tras un `.select("id")`. */
type Respuesta = {
  data: { id: string }[] | null;
  error: { message: string; code?: string } | null;
};

/**
 * Interpreta la respuesta de una escritura, una sola vez para las seis.
 *
 * Recibe la respuesta ya resuelta, no la consulta: así el `from("precio_regular")`
 * queda escrito en cada acción con su literal y los tipos generados de la tabla
 * siguen validando la fila. Con la tabla en una variable, supabase-js pierde el
 * tipo y `Record<string, unknown>` pasaría cualquier campo.
 */
function resultado(
  tabla: Tabla,
  seccion: string,
  operacion: "alta" | "edición",
  { data, error }: Respuesta,
): ResultadoAccion {
  if (error) {
    console.error(
      `[comercial] ${operacion} de ${tabla}`,
      error.message.slice(0, 200),
    );
    return { ok: false, error: mensajeDe(error.code, tabla) };
  }
  if (!data?.length) return { ok: false, error: SIN_PERMISO };

  revalidatePath(seccion);
  return { ok: true };
}

const DATOS_INVALIDOS = "Datos inválidos";

function invalidos(issues: unknown): ResultadoAccion {
  return { ok: false, error: DATOS_INVALIDOS, detalles: issues };
}

export async function crearPrecio(datos: unknown): Promise<ResultadoAccion> {
  const parsed = altaPrecioRegularSchema.safeParse(datos);
  if (!parsed.success) return invalidos(parsed.error.issues);

  const supabase = await createServerSupabaseClient();
  return resultado(
    "precio_regular",
    PRECIOS,
    "alta",
    await supabase.from("precio_regular").insert(parsed.data).select("id"),
  );
}

export async function editarPrecio(
  id: string,
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = altaPrecioRegularSchema.safeParse(datos);
  if (!parsed.success) return invalidos(parsed.error.issues);

  const supabase = await createServerSupabaseClient();
  return resultado(
    "precio_regular",
    PRECIOS,
    "edición",
    await supabase
      .from("precio_regular")
      .update(parsed.data)
      .eq("id", id)
      .select("id"),
  );
}

export async function crearPromocion(datos: unknown): Promise<ResultadoAccion> {
  const parsed = altaPromocionSchema.safeParse(datos);
  if (!parsed.success) return invalidos(parsed.error.issues);

  const supabase = await createServerSupabaseClient();
  return resultado(
    "promocion",
    PRECIOS,
    "alta",
    await supabase.from("promocion").insert(parsed.data).select("id"),
  );
}

export async function editarPromocion(
  id: string,
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = altaPromocionSchema.safeParse(datos);
  if (!parsed.success) return invalidos(parsed.error.issues);

  const supabase = await createServerSupabaseClient();
  return resultado(
    "promocion",
    PRECIOS,
    "edición",
    await supabase
      .from("promocion")
      .update(parsed.data)
      .eq("id", id)
      .select("id"),
  );
}

export async function crearExhibicion(
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = altaExhibicionSchema.safeParse(datos);
  if (!parsed.success) return invalidos(parsed.error.issues);

  const supabase = await createServerSupabaseClient();
  return resultado(
    "exhibicion_negociada",
    EXHIBICIONES,
    "alta",
    await supabase
      .from("exhibicion_negociada")
      .insert(parsed.data)
      .select("id"),
  );
}

export async function editarExhibicion(
  id: string,
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = altaExhibicionSchema.safeParse(datos);
  if (!parsed.success) return invalidos(parsed.error.issues);

  const supabase = await createServerSupabaseClient();
  return resultado(
    "exhibicion_negociada",
    EXHIBICIONES,
    "edición",
    await supabase
      .from("exhibicion_negociada")
      .update(parsed.data)
      .eq("id", id)
      .select("id"),
  );
}
