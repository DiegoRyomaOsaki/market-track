"use server";

import { revalidatePath } from "next/cache";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  abrirPeriodoPrecioSchema,
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

/**
 * Lo que ve el operador cuando intenta reescribir algo que ya rigió.
 *
 * La verja vive en la base —un trigger—, no aquí: `authenticated` tiene UPDATE
 * sobre estas tablas y un PATCH directo se saltaría cualquier comprobación que
 * viviera solo en el panel. Esto solo traduce.
 */
const HISTORICO: Record<Tabla, string> = {
  precio_regular:
    "Ese precio ya rigió y no se puede reescribir: abre un periodo nuevo con otra fecha de vigencia.",
  promocion:
    "Esa promoción ya arrancó y no se puede reescribir: crea una nueva. Sí puedes cortarla desde hoy.",
  exhibicion_negociada: "No se pudo guardar la exhibición",
};

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
  // Dos periodos que se pisan. Solo puede pasar en `precio_regular`: es la única
  // tabla con restricción de exclusión.
  if (codigo === "23P01")
    return "Ese tramo de fechas se solapa con otro periodo del mismo SKU y cadena";
  // Lo levantan los triggers que protegen el histórico. El único CHECK que un
  // formulario puede tocar —que la vigencia no acabe antes de empezar— ya lo
  // rechaza Zod antes de salir del navegador, así que un 23514 que llega hasta
  // aquí es la regla temporal.
  if (codigo === "23514") return HISTORICO[tabla];
  return `No se pudo guardar ${ENTIDAD[tabla]}`;
}

/** Lo que devuelve PostgREST tras un `.select("id")`. */
type Respuesta = {
  data: { id: string }[] | null;
  error: { message: string; code?: string } | null;
};

const SKUS_AJENOS =
  "Alguno de los SKUs elegidos no es de este cliente. Vuelve a seleccionarlos.";

/**
 * ¿Todos estos SKUs son del cliente que se dice?
 *
 * `exhibicion_negociada.sku_ids` es un `uuid[]` SIN clave foránea: la base no
 * comprueba de quién es cada elemento, y las FK compuestas del resto de columnas
 * no alcanzan al contenido de un array. Sin esto, una exhibición puede guardarse
 * con los SKUs de otro cliente — y el filtro del formulario no lo impide, porque
 * es UX: una llamada directa a la acción manda lo que quiera.
 *
 * Se consulta con el cliente de la sesión, así que la RLS acota lo visible: un
 * id que quien llama no puede leer no aparece y la cuenta no cuadra.
 */
async function todosLosSkusSonDelCliente(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  tenantId: string,
  skuIds: string[],
): Promise<boolean> {
  if (skuIds.length === 0) return true;

  const { data, error } = await supabase
    .from("sku")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("id", skuIds);

  if (error) {
    console.error("[comercial] skus del cliente", error.message.slice(0, 200));
    return false;
  }
  // Los ids repetidos cuentan una vez: comparar contra `skuIds.length` a secas
  // rechazaría una lista con un duplicado que sí es del cliente.
  return new Set(skuIds).size === (data?.length ?? 0);
}

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

/**
 * Abre un periodo de precio: cierra el vigente y arranca el nuevo.
 *
 * Va por RPC y no por un `insert` porque son DOS escrituras que solo tienen
 * sentido juntas, y PostgREST no da transacción multi-sentencia: un fallo entre
 * el cierre y la apertura dejaría al SKU sin ningún precio vigente — y eso no da
 * error en ninguna pantalla, da `sin_precio_vigente`, o sea que el SKU sale del
 * denominador de Perfect Store en silencio.
 */
export async function abrirPeriodoPrecio(
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = abrirPeriodoPrecioSchema.safeParse(datos);
  if (!parsed.success) return invalidos(parsed.error.issues);

  const supabase = await createServerSupabaseClient();
  const { tipo_tienda } = parsed.data;
  const { error } = await supabase.rpc("abrir_periodo_precio", {
    p_sku: parsed.data.sku_id,
    p_cadena: parsed.data.cadena_id,
    p_precio: parsed.data.precio,
    p_vigente_desde: parsed.data.vigente_desde,
    // Se OMITE cuando es nulo en vez de mandarlo: el default de la función ya
    // es null, y "toda la cadena" es el caso mayoritario.
    ...(tipo_tienda ? { p_tipo_tienda: tipo_tienda } : {}),
  });

  if (error) {
    console.error(
      "[comercial] apertura de periodo de precio",
      error.message.slice(0, 200),
    );
    // La RPC levanta su propia excepción con mensaje para el operador cuando la
    // fecha no es posterior a la vigente; ese texto es mejor que el genérico.
    if (error.code === "23514" && error.message.includes("empezar después"))
      return { ok: false, error: error.message.slice(0, 200) };
    return { ok: false, error: mensajeDe(error.code, "precio_regular") };
  }

  revalidatePath(PRECIOS);
  return { ok: true };
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
  const { tenant_id, sku_ids } = parsed.data;
  if (!(await todosLosSkusSonDelCliente(supabase, tenant_id, sku_ids))) {
    return { ok: false, error: SKUS_AJENOS };
  }

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
  const { tenant_id, sku_ids } = parsed.data;
  if (!(await todosLosSkusSonDelCliente(supabase, tenant_id, sku_ids))) {
    return { ok: false, error: SKUS_AJENOS };
  }

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
