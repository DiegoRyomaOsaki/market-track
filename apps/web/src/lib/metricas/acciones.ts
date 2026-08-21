"use server";

import { revalidatePath } from "next/cache";

import {
  altaConfigMerchandiserSchema,
  altaConfigPerfectStoreSchema,
  pesosMerchandiserSchema,
  previaPerfectStoreSchema,
  publicarEscaleraBonoSchema,
} from "@market-track/shared";
import { z } from "zod";

import { createServerSupabaseClient } from "@/lib/supabase/server";

// Las escrituras de la pantalla de métricas. Las tres publican una VERSIÓN
// nueva: las tablas son inmutables y editar una fila publicada la rechaza un
// trigger. Por eso no hay ninguna acción de "actualizar".
//
// La autorización la pone la RLS (`*_admin_escribe`), no estas funciones. Si la
// pusieran aquí habría dos reglas de acceso que podrían desincronizarse, y la de
// aquí no protegería una llamada directa por PostgREST.

export type ResultadoAccion =
  { ok: true } | { ok: false; error: string; detalles?: unknown };

const SECCION_ADMIN = "/admin/metricas";
const SECCION_SUPERVISOR = "/supervisor/metricas";

// Un INSERT que la RLS bloquea NO da error: afecta a 0 filas y devuelve éxito.
// Por eso la escritura pide `.select()` y comprueba que volvió algo.
const SIN_PERMISO = "No encontrado o sin permiso";

function fallo(
  operacion: string,
  mensaje: string,
  visible: string,
): { ok: false; error: string } {
  // El mensaje del driver puede arrastrar contenido de la respuesta: se recorta
  // para el log y NUNCA se devuelve al navegador tal cual.
  console.error(`[metricas] ${operacion}`, mensaje.slice(0, 200));
  return { ok: false, error: visible };
}

function revalidar(): void {
  // Las dos rutas: la pantalla es la misma para admin y supervisor, y publicar
  // desde una tiene que refrescar la otra.
  revalidatePath(SECCION_ADMIN);
  revalidatePath(SECCION_SUPERVISOR);
}

/** Publica una versión de la configuración de Perfect Store para una marca. */
export async function publicarConfigPerfectStore(
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = altaConfigPerfectStoreSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Revisa los campos marcados",
      detalles: parsed.error.issues,
    };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("config_perfect_store")
    .insert(parsed.data)
    .select("id")
    .maybeSingle();

  if (error) {
    // La clave natural incluye el alcance y la fecha: publicar dos veces lo
    // mismo el mismo día es un error del admin, no del sistema.
    if (error.code === "23505") {
      return {
        ok: false,
        error:
          "Ya existe una configuración con ese alcance y esa fecha de vigencia",
      };
    }
    return fallo(
      "publicar config perfect store",
      error.message,
      "No se pudo publicar la configuración",
    );
  }
  if (!data) return { ok: false, error: SIN_PERMISO };

  console.info(
    JSON.stringify({
      evento: "config_perfect_store_publicada",
      tenant_id: parsed.data.tenant_id,
      marca_id: parsed.data.marca_id,
      vigente_desde: parsed.data.vigente_desde,
    }),
  );
  revalidar();
  return { ok: true };
}

/** Publica una versión de la configuración del plan de lealtad. */
export async function publicarConfigMerchandiser(
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = altaConfigMerchandiserSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Revisa los campos marcados",
      detalles: parsed.error.issues,
    };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("config_perfect_merchandiser")
    .insert(parsed.data)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "Ya existe una configuración vigente desde esa fecha",
      };
    }
    return fallo(
      "publicar config merchandiser",
      error.message,
      "No se pudo publicar la configuración",
    );
  }
  if (!data) return { ok: false, error: SIN_PERMISO };

  console.info(
    JSON.stringify({
      evento: "config_merchandiser_publicada",
      tenant_id: parsed.data.tenant_id,
      vigente_desde: parsed.data.vigente_desde,
      periodicidad: parsed.data.periodicidad,
    }),
  );
  revalidar();
  return { ok: true };
}

/**
 * Publica la escalera de bonos ENTERA.
 *
 * Va por RPC y no por un `insert` de varias filas: el insert directo tiene
 * éxito y FUSIONA la escalera nueva con la que ya hubiera en esa fecha —la
 * clave natural solo choca si coincide el umbral exacto— y como no hay `delete`
 * para la app, esa mezcla no se puede deshacer. De estas filas sale un bono.
 */
export async function publicarEscaleraBono(
  datos: unknown,
): Promise<ResultadoAccion> {
  const parsed = publicarEscaleraBonoSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Revisa los campos marcados",
      detalles: parsed.error.issues,
    };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("publicar_escalera_bono", {
    p_tenant_id: parsed.data.tenant_id,
    p_vigente_desde: parsed.data.vigente_desde,
    p_niveles: parsed.data.niveles,
  });

  if (error) {
    if (error.code === "23514") {
      return {
        ok: false,
        error: `Ya hay una escalera de bonos vigente desde ${parsed.data.vigente_desde}. Elige otra fecha.`,
      };
    }
    if (error.code === "42501") return { ok: false, error: SIN_PERMISO };
    return fallo(
      "publicar escalera",
      error.message,
      "No se pudo publicar la escalera de bonos",
    );
  }

  console.info(
    JSON.stringify({
      evento: "escalera_bono_publicada",
      tenant_id: parsed.data.tenant_id,
      vigente_desde: parsed.data.vigente_desde,
      niveles: parsed.data.niveles.length,
    }),
  );
  revalidar();
  return { ok: true };
}

// La previa también valida en la frontera. Una Server Action es un endpoint
// POST alcanzable sin pasar por el formulario: sin esto, un `pesos` con claves
// de más o valores fuera de rango llegaría tal cual a la RPC.
//
// `z.guid()` y no `z.uuid()`: el estricto exige bits de versión que Postgres no
// impone y rechazaría ids perfectamente válidos.
const idSchema = z.guid();

export type PreviaPuntaje = {
  etiqueta: string;
  detalle: string;
  actual: number | null;
  previsto: number | null;
};

/** El efecto de unos pesos sin guardar sobre el Perfect Store más reciente. */
export async function previsualizarPerfectStore(
  marcaId: string,
  // La política es un string y no un número: entra en el mismo objeto que los
  // pesos porque es lo que la RPC recibe como un solo jsonb.
  pesos: Record<string, number | string>,
): Promise<
  { ok: true; previa: PreviaPuntaje | null } | { ok: false; error: string }
> {
  const marca = idSchema.safeParse(marcaId);
  const validos = previaPerfectStoreSchema.safeParse(pesos);
  if (!marca.success || !validos.success) {
    return { ok: false, error: "Revisa los pesos antes de ver el efecto" };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .rpc("previsualizar_perfect_store", {
      p_marca_id: marca.data,
      p_pesos: validos.data,
    })
    .maybeSingle();

  if (error) {
    return fallo(
      "previsualizar perfect store",
      error.message,
      "No se pudo calcular la vista previa",
    );
  }
  if (!data) return { ok: true, previa: null };

  return {
    ok: true,
    previa: {
      etiqueta: data.tienda_nombre ?? "Tienda",
      detalle: `Calculado el ${new Date(data.calculado_at).toLocaleDateString("es-PE")}`,
      actual: data.total_actual,
      previsto: data.total_previsto,
    },
  };
}

/** El efecto de unos pesos sin guardar sobre el periodo más reciente. */
export async function previsualizarMerchandiser(
  tenantId: string,
  pesos: Record<string, number>,
): Promise<
  { ok: true; previa: PreviaPuntaje | null } | { ok: false; error: string }
> {
  const tenant = idSchema.safeParse(tenantId);
  const validos = pesosMerchandiserSchema.safeParse(pesos);
  if (!tenant.success || !validos.success) {
    return { ok: false, error: "Revisa los pesos antes de ver el efecto" };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .rpc("previsualizar_merchandiser", {
      p_tenant_id: tenant.data,
      p_pesos: validos.data,
    })
    .maybeSingle();

  if (error) {
    return fallo(
      "previsualizar merchandiser",
      error.message,
      "No se pudo calcular la vista previa",
    );
  }
  if (!data) return { ok: true, previa: null };

  return {
    ok: true,
    previa: {
      etiqueta: data.mercaderista ?? "Mercaderista",
      detalle: `Periodo ${data.tipo} desde ${data.periodo_inicio}`,
      actual: data.total_actual,
      previsto: data.total_previsto,
    },
  };
}
