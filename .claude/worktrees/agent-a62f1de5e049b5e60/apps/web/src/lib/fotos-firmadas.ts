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
 * El presupuesto TOTAL del firmado, no el de cada lote.
 *
 * Los defaults del SDK rondan los 30 s y una conexión colgada se come el
 * presupuesto de la petición entera antes de que el supervisor vea nada. Pero un
 * plazo POR LOTE tampoco acota nada: con los lotes en serie, una visita de varias
 * marcas son N llamadas y el peor caso es N × plazo. Los lotes van en paralelo
 * contra un único reloj, así que el tiempo total lo marca el lote más lento.
 */
const PRESUPUESTO_MS = 10_000;

/**
 * El mensaje de un fallo, acotado. Los errores de un cliente de infraestructura
 * pueden arrastrar contenido de la respuesta en su `.message`, así que se recorta
 * antes de registrarlo.
 */
function mensajeDe(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200);
}

/** Un reloj único que todos los lotes comparten. */
function relojDe(ms: number) {
  let cancelar: ReturnType<typeof setTimeout>;
  const agotado = new Promise<never>((_, rechazar) => {
    cancelar = setTimeout(() => rechazar(new Error("plazo agotado")), ms);
  });
  // Sin `catch` vacío, el rechazo del reloj queda sin manejar cuando todos los
  // lotes terminan antes y nadie llega a esperarlo.
  agotado.catch(() => undefined);
  return {
    correr: <T>(promesa: Promise<T>) => Promise.race([promesa, agotado]),
    parar: () => clearTimeout(cancelar),
  };
}

export type Firmadas = {
  urls: Record<string, string>;
  /**
   * ¿Falló algún lote? Distingue dos cosas que se ven idénticas y no lo son:
   * una foto ausente del mapa puede ser que aún no esté subida (culpa de nadie)
   * o que el firmador esté caído (culpa nuestra).
   *
   * Sin esta señal, un secreto de R2 mal puesto haría que la galería dijera
   * "pendiente de subida desde el teléfono" en todas las tiendas, y el cliente
   * llamaría a quejarse de unos mercaderistas que sí hicieron su trabajo.
   */
  degradado: boolean;
};

/**
 * Firma la lectura de las fotos pedidas. Devuelve el mapa `fotoId → url` y si
 * hubo que degradar.
 *
 * Una foto ausente del mapa NO es necesariamente un error: la Edge Function
 * omite las que el llamante no puede ver, y aquí se omiten además las que aún no
 * se han subido a R2 — no hay objeto que firmar mientras el binario siga en el
 * teléfono. Para eso está `degradado`.
 *
 * Si el firmado falla, devuelve lo que haya conseguido en vez de tumbar la
 * pantalla: media evidencia se revisa; ninguna, no.
 */
export async function urlsFirmadas(
  supabase: ClienteServidor,
  fotoIds: readonly string[],
): Promise<Firmadas> {
  if (fotoIds.length === 0) return { urls: {}, degradado: false };

  const urls: Record<string, string> = {};
  let degradado = false;
  const reloj = relojDe(PRESUPUESTO_MS);

  // `allSettled` y no `all`: un lote que falle no puede llevarse por delante los
  // que sí firmaron. Media evidencia se revisa; ninguna, no.
  const lotes = await Promise.allSettled(
    trocear(fotoIds, TOPE_LOTE).map((grupo) =>
      reloj.correr(
        supabase.functions.invoke<{ urls: Record<string, string> }>(
          "fotos-url-firmada",
          { body: { foto_ids: grupo } },
        ),
      ),
    ),
  );
  reloj.parar();

  for (const lote of lotes) {
    if (lote.status === "rejected") {
      degradado = true;
      console.error("[fotos] firmar", mensajeDe(lote.reason));
      continue;
    }
    // El SDK tipa este campo como `any` (`FunctionsResponseFailure`). Anotarlo
    // `unknown` corta el contagio aquí, en el borde, en vez de dejar que se
    // propague al resto del archivo.
    const fallo: unknown = lote.value.error;
    if (fallo) {
      degradado = true;
      console.error("[fotos] firmar", mensajeDe(fallo));
      continue;
    }
    Object.assign(urls, lote.value.data?.urls ?? {});
  }

  return { urls, degradado };
}
