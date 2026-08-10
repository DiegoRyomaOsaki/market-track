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

type Tabla = "marca" | "categoria" | "cadena" | "sku" | "tienda";

async function codigosDe(
  supabase: SupabaseClient<Database>,
  tabla: Tabla,
  tenantId: string,
  buscados: readonly string[],
): Promise<Set<string>> {
  const encontrados = new Set<string>();
  if (buscados.length === 0) return encontrados;

  // Los trozos van en paralelo, igual que las cuatro tablas: en secuencia, un
  // catálogo de cuatrocientos códigos son cuatro viajes de ida y vuelta uno tras
  // otro para una sola tabla.
  const respuestas = await Promise.all(
    trocear(buscados, TOPE_POR_CONSULTA).map((trozo) =>
      supabase
        .from(tabla)
        .select("codigo_externo")
        // El filtro NO es cosmético: la RLS deja al admin leer todos los clientes,
        // así que sin él una referencia a la marca de OTRO cliente pasaría la
        // validación y reventaría al aplicar, con la vista previa diciendo que
        // todo estaba bien.
        .eq("tenant_id", tenantId)
        .in("codigo_externo", trozo),
    ),
  );

  for (const { data, error } of respuestas) {
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
 * Los códigos que el archivo referencia y que ya están en la base DE ESE CLIENTE.
 *
 * Se consulta solo lo que el archivo menciona, no el catálogo entero: un cliente
 * con miles de SKUs no tiene por qué viajar por la red para validar diez filas.
 *
 * El `tenant_id` se pasa explícito y no se deja a la RLS: el admin ve todos los
 * clientes, así que sin él la validación daría por buena una referencia cruzada
 * y la aplicación abortaría después — con la vista previa diciendo que no había
 * ningún error.
 */
export async function clavesExistentes(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  referenciados: Record<Tabla, readonly string[]>,
): Promise<ClavesExistentes> {
  const [marca, categoria, cadena, sku, tienda] = await Promise.all([
    codigosDe(supabase, "marca", tenantId, referenciados.marca),
    codigosDe(supabase, "categoria", tenantId, referenciados.categoria),
    codigosDe(supabase, "cadena", tenantId, referenciados.cadena),
    codigosDe(supabase, "sku", tenantId, referenciados.sku),
    codigosDe(supabase, "tienda", tenantId, referenciados.tienda),
  ]);
  return { marca, categoria, cadena, sku, tienda };
}
