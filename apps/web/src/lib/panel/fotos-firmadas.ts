import type { createServerSupabaseClient } from "@/lib/supabase/server";

// El cliente tipado con el esquema del proyecto. `SupabaseClient` a secas trae la
// base como `any` y contagia de `any` todo lo que se saque de él.
type ClienteServidor = Awaited<ReturnType<typeof createServerSupabaseClient>>;

// Las URLs de lectura de las fotos de evidencia.
//
// El bucket de R2 es privado: cada imagen se sirve con una URL prefirmada de vida
// corta que emite la Edge Function `fotos-url-firmada` bajo la RLS del que llama.
// Aquí solo se orquesta el lote.

/** El tope que impone la Edge Function. Un lote mayor lo rechaza ENTERO. */
const TOPE_LOTE = 50;

/** Una visita con muchas marcas pasa de 50 fotos sin ser nada raro. */
function trocear<T>(items: readonly T[], tamano: number): T[][] {
  const grupos: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) {
    grupos.push(items.slice(i, i + tamano));
  }
  return grupos;
}

/**
 * Una llamada de red en el camino de la petición necesita su propio plazo: los
 * defaults del SDK rondan los 30 s y una conexión colgada se come el presupuesto
 * de la función entera antes de que el supervisor vea nada.
 */
const DEADLINE_MS = 10_000;

/**
 * El mensaje de un fallo, acotado. Los errores de un cliente de infraestructura
 * pueden arrastrar contenido de la respuesta en su `.message`, así que se recorta
 * antes de registrarlo.
 */
function mensajeDe(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200);
}

function conPlazo<T>(promesa: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promesa,
    new Promise<never>((_, rechazar) =>
      setTimeout(() => rechazar(new Error("plazo agotado")), ms),
    ),
  ]);
}

/**
 * Firma la lectura de las fotos pedidas. Devuelve un mapa `fotoId → url`.
 *
 * Una foto ausente del mapa NO es un error: la Edge Function omite las que el
 * llamante no puede ver, y aquí se omiten además las que aún no se han subido a
 * R2 — no hay objeto que firmar mientras el binario siga en el teléfono.
 *
 * Si el firmado falla, devuelve lo que haya conseguido en vez de tumbar la
 * pantalla: un detalle sin fotos sigue siendo revisable (datos, contingencias,
 * bitácora), y un detalle que no carga no sirve para nada.
 */
export async function urlsFirmadas(
  supabase: ClienteServidor,
  fotoIds: readonly string[],
): Promise<Record<string, string>> {
  if (fotoIds.length === 0) return {};

  const urls: Record<string, string> = {};

  for (const grupo of trocear(fotoIds, TOPE_LOTE)) {
    try {
      const respuesta = await conPlazo(
        supabase.functions.invoke<{ urls: Record<string, string> }>(
          "fotos-url-firmada",
          { body: { foto_ids: grupo } },
        ),
        DEADLINE_MS,
      );
      // El SDK tipa este campo como `any` (`FunctionsResponseFailure`). Anotarlo
      // `unknown` corta el contagio aquí, en el borde, en vez de dejar que se
      // propague al resto del archivo.
      const fallo: unknown = respuesta.error;
      if (fallo) {
        console.error("[revision] firmar fotos", mensajeDe(fallo));
        continue;
      }
      Object.assign(urls, respuesta.data?.urls ?? {});
    } catch (e) {
      console.error("[revision] firmar fotos", mensajeDe(e));
    }
  }

  return urls;
}
