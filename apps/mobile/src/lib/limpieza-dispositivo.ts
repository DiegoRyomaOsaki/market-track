import * as FileSystem from "expo-file-system/legacy";

// Lo que la app deja en el disco del teléfono, enumerado en UN solo sitio.
//
// Antes cada módulo se guardaba su ruta y la limpieza al reasignar el teléfono
// solo sabía de fotos: el fichero de descartes y el de tránsito sobrevivían al
// cambio de mercaderista. No son evidencia de campo como una foto, pero los
// descartes dicen qué avisos vio una persona concreta y el tránsito, sus tiempos
// entre tiendas. La revocación tiene que alcanzarlo todo, no lo más llamativo.
//
// Las rutas viven aquí y los módulos las importan, no al revés: así el módulo
// que enumera no depende de ninguno de ellos —se puede limpiar sin arrastrar la
// cola de fotos ni Supabase— y añadir un fichero pasa por este fichero.

const DIR = FileSystem.documentDirectory;

/** El manifiesto de la cola de fotos. */
export const RUTA_MANIFIESTO_FOTOS = `${DIR}cola-fotos.json`;

/**
 * El temporal del manifiesto. Existe porque la escritura es "temporal +
 * renombrado", y un corte de batería a mitad lo deja atrás: es un fichero real
 * que puede sobrevivir con la cola del mercaderista anterior dentro.
 */
export const RUTA_MANIFIESTO_TEMPORAL = `${RUTA_MANIFIESTO_FOTOS}.tmp`;

/** Los binarios de las fotos pendientes de subir. */
export const DIR_FOTOS = `${DIR}fotos`;

/** Qué avisos de parada retirada ya descartó el mercaderista. */
export const RUTA_DESCARTES = `${DIR}descartes-retiro.json`;

/** El cronómetro de traslado entre tiendas. */
export const RUTA_TRANSITO = `${DIR}transito.json`;

/**
 * Todo lo anterior, en el orden en que se borra. La lista es lo que convierte
 * "acordarse de limpiar" en "estar en la lista".
 */
export const RUTAS_EN_DISCO = [
  DIR_FOTOS,
  RUTA_MANIFIESTO_FOTOS,
  RUTA_MANIFIESTO_TEMPORAL,
  RUTA_DESCARTES,
  RUTA_TRANSITO,
] as const;

/**
 * Borra del teléfono todo lo del mercaderista anterior.
 *
 * Va junto a `disconnectAndClear()`, que es lo que limpia la réplica: esa es de
 * PowerSync y se borra con su API; esto es lo que escribimos nosotros. Si la
 * réplica se limpia y los ficheros se quedan, el teléfono conserva rastro de
 * alguien que ya no tiene contexto aquí.
 *
 * `idempotent` en cada borrado: que falte un fichero es lo normal —el
 * mercaderista pudo no haber descartado ningún aviso—, no un error.
 */
export async function limpiarDispositivo(): Promise<void> {
  for (const ruta of RUTAS_EN_DISCO) {
    await FileSystem.deleteAsync(ruta, { idempotent: true });
  }
}
