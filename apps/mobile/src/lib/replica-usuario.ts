import * as SecureStore from "expo-secure-store";

// Quién es el dueño de la réplica local de este teléfono.
//
// La app es offline-first: la réplica SQLite es la fuente de verdad de los flujos
// de campo. Si un teléfono se reasigna a otro mercaderista, sus datos (rutero,
// visitas, tiendas) seguirían en el disco y el nuevo usuario los vería hasta un
// resync —y sin señal, nunca—: una fuga entre inquilinos. Por eso, al entrar, se
// limpia la réplica si el teléfono era de OTRO usuario. Si es el mismo que vuelve,
// se conserva: no pierde su trabajo offline.

const CLAVE = "replica-usuario";

/** ¿Hay que limpiar la réplica antes de entrar como `actual`? */
export function debeLimpiarReplica(
  anterior: string | null,
  actual: string,
): boolean {
  // Solo si el teléfono ya tenía datos de otro usuario. Primera vez (null) o el
  // mismo usuario: no se toca nada.
  return anterior !== null && anterior !== actual;
}

/** El último mercaderista que sincronizó en este teléfono, o null si ninguno. */
export async function leerUltimoUsuario(): Promise<string | null> {
  return SecureStore.getItemAsync(CLAVE);
}

/** Marca a `id` como dueño actual de la réplica local. */
export async function guardarUltimoUsuario(id: string): Promise<void> {
  await SecureStore.setItemAsync(CLAVE, id);
}
