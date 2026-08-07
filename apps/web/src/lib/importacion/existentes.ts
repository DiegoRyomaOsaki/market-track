import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@market-track/db";

import type { ClavesExistentes } from "./validacion";

// Qué códigos del maestro ya están en la base. La validación los necesita para
// distinguir "el cliente referencia algo que no existe" de "lo crea en este mismo
// archivo".

/**
 * PostgREST manda el `in.(…)` en la URL: con quinientos códigos revienta por
 * longitud. Se trocea, y de paso ningún lote se acerca al `max_rows` del servidor.
 */
const TOPE_POR_CONSULTA = 100;

function trocear<T>(items: readonly T[], tamano: number): T[][] {
  const trozos: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) {
    trozos.push(items.slice(i, i + tamano));
  }
  return trozos;
}

type Tabla = "marca" | "cadena" | "sku" | "tienda";

async function codigosDe(
  supabase: SupabaseClient<Database>,
  tabla: Tabla,
  buscados: readonly string[],
): Promise<Set<string>> {
  const encontrados = new Set<string>();
  if (buscados.length === 0) return encontrados;

  for (const trozo of trocear(buscados, TOPE_POR_CONSULTA)) {
    const { data, error } = await supabase
      .from(tabla)
      .select("codigo_externo")
      .in("codigo_externo", trozo);

    // Un fallo de lectura NO puede pasar por "no existe ninguno": la validación
    // marcaría todas las referencias como rotas y el operador buscaría un
    // problema en su Excel que no está ahí.
    if (error) throw new Error(`No se pudieron leer los ${tabla}s existentes`);

    for (const fila of data ?? []) {
      if (fila.codigo_externo !== null) encontrados.add(fila.codigo_externo);
    }
  }
  return encontrados;
}

/**
 * Los códigos que el archivo referencia y que ya podrían estar en la base.
 *
 * Se consulta solo lo que el archivo menciona, no el catálogo entero: un cliente
 * con miles de SKUs no tiene por qué viajar por la red para validar diez filas.
 *
 * Sin filtro de tenant: la RLS acota al del llamante. Un admin ve todos los
 * clientes, y eso es correcto — lo que decide en cuál se escribe es la fila
 * `importacion`, dentro de la transacción.
 */
export async function clavesExistentes(
  supabase: SupabaseClient<Database>,
  referenciados: Record<Tabla, readonly string[]>,
): Promise<ClavesExistentes> {
  const [marca, cadena, sku, tienda] = await Promise.all([
    codigosDe(supabase, "marca", referenciados.marca),
    codigosDe(supabase, "cadena", referenciados.cadena),
    codigosDe(supabase, "sku", referenciados.sku),
    codigosDe(supabase, "tienda", referenciados.tienda),
  ]);
  return { marca, cadena, sku, tienda };
}
