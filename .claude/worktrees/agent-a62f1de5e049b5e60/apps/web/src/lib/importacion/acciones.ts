"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Database } from "@market-track/db";
import type { ErrorImportacion } from "@market-track/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sesionDeStaff } from "@/lib/panel/sesion";

import { clavesExistentes } from "./existentes";
import { parsearMaestro } from "./parseo";
import { TOPE_BYTES } from "./plantilla";
import { codigosReferenciados, validarMaestro } from "./validacion";

// Las dos operaciones del importador: validar (que no escribe nada) y aplicar.
//
// Son dos porque la pantalla tiene que enseñar los errores ANTES de tocar el
// maestro del cliente. La validación es idéntica en las dos: al aplicar NO se
// confía en lo que dijo la previsualización — el archivo se vuelve a leer y a
// validar, y el hash comprueba que sea el mismo que se revisó.
//
// Las dos reciben `FormData` porque son el punto de entrada desde el navegador y
// un `Buffer` no cruza esa frontera. La conversión ocurre aquí, en el servidor:
// el resto del importador sigue hablando de bytes.

const SECCION = "/admin/importar";

const CAMPO_ARCHIVO = "archivo";

/**
 * Los bytes del archivo subido, o `null` si el campo no vino o no es un archivo.
 *
 * Una server action es un endpoint POST: lo que llega es lo que el cliente quiso
 * mandar, no lo que el formulario enseñaba. El tope de bytes se comprueba antes
 * de materializar el buffer — un .xlsx es un zip y descomprimirlo es justo lo que
 * no queremos hacer con un archivo de tamaño arbitrario.
 */
async function bytesDeFormData(
  formData: FormData,
): Promise<{ ok: true; archivo: Buffer } | { ok: false; error: string }> {
  const subido = formData.get(CAMPO_ARCHIVO);
  if (!(subido instanceof File) || subido.size === 0) {
    return { ok: false, error: "Falta el archivo" };
  }
  if (subido.size > TOPE_BYTES) {
    return { ok: false, error: "El archivo es demasiado grande" };
  }
  return { ok: true, archivo: Buffer.from(await subido.arrayBuffer()) };
}

/** El valor de un campo de texto del formulario; `null` si vino un archivo. */
function textoDe(formData: FormData, campo: string): string | null {
  const valor = formData.get(campo);
  return typeof valor === "string" ? valor : null;
}

export type ResultadoValidacion =
  | {
      ok: true;
      importacionId: string;
      errores: ErrorImportacion[];
      erroresOmitidos: number;
      resumen: Record<string, number>;
    }
  | { ok: false; error: string };

export type ResultadoAplicacion =
  { ok: true; resumen: Record<string, number> } | { ok: false; error: string };

function hashDe(bytes: Buffer): string {
  // Lo calcula el SERVIDOR. Si viniera del cliente, la comprobación de que se
  // aplica el mismo archivo que se revisó no valdría nada.
  return createHash("sha256").update(bytes).digest("hex");
}

/** Lee, valida y guarda el informe. No escribe NADA en el maestro. */
async function revisar(archivo: Buffer, tenantId: string) {
  // El rol PRIMERO, antes de descomprimir nada. Descomprimir y parsear un zip
  // arbitrario es trabajo real: hacerlo antes de saber quién llama lo regala a
  // cualquiera con sesión. Que el middleware cubra hoy `/admin` no lo autoriza
  // — una server action es un endpoint por sí misma.
  const sesion = await sesionDeStaff();
  if (sesion === null || sesion.perfil.rol !== "admin") {
    return {
      ok: false as const,
      error: "Solo un administrador importa el maestro",
    };
  }

  const parseo = await parsearMaestro(archivo);
  if (!parseo.ok) return { ok: false as const, error: parseo.error };

  const existentes = await clavesExistentes(
    sesion.supabase,
    tenantId,
    codigosReferenciados(parseo.hojas),
  );
  const { lote, errores, erroresOmitidos } = validarMaestro(
    parseo.hojas,
    existentes,
  );

  const resumen = Object.fromEntries(
    Object.entries(lote).map(([hoja, filas]) => [hoja, filas.length]),
  );

  return {
    ok: true as const,
    supabase: sesion.supabase,
    perfil: sesion.perfil,
    lote,
    errores,
    erroresOmitidos,
    resumen,
  };
}

const validarSchema = z.object({ tenantId: z.guid() });

/**
 * Previsualiza el maestro: deja constancia de lo que se subió y de sus errores,
 * sin tocar ninguna tabla del catálogo.
 */
export async function validarImportacion(
  formData: FormData,
): Promise<ResultadoValidacion> {
  const parsed = validarSchema.safeParse({
    tenantId: textoDe(formData, "tenantId"),
  });
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };

  const bytes = await bytesDeFormData(formData);
  if (!bytes.ok) return bytes;
  const archivo = bytes.archivo;

  const revision = await revisar(archivo, parsed.data.tenantId);
  if (!revision.ok) return revision;

  const { data, error } = await revision.supabase
    .from("importacion")
    .insert({
      tenant_id: parsed.data.tenantId,
      subido_por: revision.perfil.id,
      archivo_hash: hashDe(archivo),
      // El estado decide si se puede aplicar: con errores, no.
      estado: revision.errores.length > 0 ? "con_errores" : "previsualizada",
      errores: revision.errores,
      resumen: revision.resumen,
    })
    .select("id");

  if (error) {
    console.error("[importacion] previsualizar", error.message.slice(0, 200));
    return { ok: false, error: "No se pudo registrar la importación" };
  }
  const fila = data?.[0];
  if (!fila) return { ok: false, error: "No encontrado o sin permiso" };

  console.info(
    JSON.stringify({
      evento: "importacion_previsualizada",
      importacion_id: fila.id,
      tenant_id: parsed.data.tenantId,
      errores: revision.errores.length,
    }),
  );

  revalidatePath(SECCION);
  return {
    ok: true,
    importacionId: fila.id,
    errores: revision.errores,
    erroresOmitidos: revision.erroresOmitidos,
    resumen: revision.resumen,
  };
}

const aplicarSchema = z.object({ importacionId: z.guid() });

/**
 * Aplica el maestro. Todo o nada: la transacción vive en la función de Postgres,
 * que revierte las siete tablas si cualquiera falla.
 */
export async function aplicarImportacion(
  formData: FormData,
): Promise<ResultadoAplicacion> {
  const parsed = aplicarSchema.safeParse({
    importacionId: textoDe(formData, "importacionId"),
  });
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };

  const bytes = await bytesDeFormData(formData);
  if (!bytes.ok) return bytes;
  const archivo = bytes.archivo;

  const sesion = await sesionDeStaff();
  if (sesion === null || sesion.perfil.rol !== "admin") {
    return { ok: false, error: "Solo un administrador importa el maestro" };
  }

  // El tenant sale de la FILA, igual que dentro de la transacción: validar contra
  // el catálogo de un cliente y aplicar sobre otro sería incoherente.
  const { data: importacion, error: errorLectura } = await sesion.supabase
    .from("importacion")
    .select("tenant_id, archivo_hash")
    .eq("id", parsed.data.importacionId)
    .maybeSingle();

  if (errorLectura) {
    console.error("[importacion] lectura", errorLectura.message.slice(0, 200));
    return { ok: false, error: "No se pudo leer la importación" };
  }
  if (!importacion) return { ok: false, error: "No encontrada o sin permiso" };

  const revision = await revisar(archivo, importacion.tenant_id);
  if (!revision.ok) return revision;
  if (revision.errores.length > 0) {
    return {
      ok: false,
      error: "El archivo tiene errores. Corrígelos y vuelve a previsualizar.",
    };
  }

  // Se previsualizó un archivo y se está aplicando otro: sin esta comprobación,
  // el operador revisaría unos errores y aplicaría datos distintos.
  if (importacion.archivo_hash !== hashDe(archivo)) {
    return {
      ok: false,
      error: "El archivo no es el que se revisó. Vuelve a previsualizar.",
    };
  }

  const { data, error } = await revision.supabase.rpc("aplicar_importacion", {
    p_importacion_id: parsed.data.importacionId,
    p_lote: revision.lote,
  });

  if (error) {
    console.error("[importacion] aplicar", error.message.slice(0, 200));
    // La transacción se revirtió entera, INCLUIDO cualquier update de estado que
    // hubiera dentro. El motivo se escribe fuera, en su propia llamada, o la
    // pantalla no sabría por qué falló.
    await anotarFallo(
      revision.supabase,
      parsed.data.importacionId,
      error.message,
    );
    return { ok: false, error: "No se pudo aplicar el maestro" };
  }

  console.info(
    JSON.stringify({
      evento: "importacion_aplicada",
      importacion_id: parsed.data.importacionId,
      resumen: data,
    }),
  );

  revalidatePath(SECCION);
  return { ok: true, resumen: (data ?? {}) as Record<string, number> };
}

/** Deja el motivo del fallo donde la pantalla lo pueda leer. */
async function anotarFallo(
  supabase: SupabaseClient<Database>,
  importacionId: string,
  mensaje: string,
): Promise<void> {
  // En su propio try: si anotar el fallo falla también, el error que se le
  // devuelve al operador no puede cambiar por eso.
  try {
    await supabase
      .from("importacion")
      .update({
        errores: [
          {
            hoja: "—",
            fila: 1,
            columna: null,
            valor: null,
            mensaje: mensaje.slice(0, 300),
          },
        ],
      })
      .eq("id", importacionId);
  } catch (err) {
    console.error(
      "[importacion] no se pudo anotar el fallo",
      err instanceof Error ? err.message.slice(0, 200) : String(err),
    );
  }
}
