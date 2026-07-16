// Dónde vive la sesión del mercaderista en el teléfono.
//
// Va en SecureStore (Keychain en iOS, Keystore en Android) y no en AsyncStorage:
// el teléfono es de campo y el token se guarda cifrado por el sistema.
//
// El problema: la documentación de Expo avisa de que "Large payloads can be
// rejected by the underlying platform. Historically, some iOS releases refused
// values above roughly 2048 bytes". Una sesión de Supabase (access token +
// refresh token + usuario) pasa de eso. Si la escritura falla, la app no se
// entera y el mercaderista tiene que volver a hacer login cada vez que la abre —
// en un sótano sin señal, eso es quedarse fuera.
//
// Por eso el valor se trocea. El índice guarda cuántos trozos hay; si falta
// alguno, se devuelve null: media sesión no es una sesión.

const TAMANO_TROZO = 1500; // holgado bajo el ~2048 histórico de iOS

export type ApiSecureStore = {
  getItemAsync: (clave: string) => Promise<string | null>;
  setItemAsync: (clave: string, valor: string) => Promise<void>;
  deleteItemAsync: (clave: string) => Promise<void>;
};

/** Lo que espera Supabase como almacén de sesión. */
export type AlmacenSesion = {
  getItem: (clave: string) => Promise<string | null>;
  setItem: (clave: string, valor: string) => Promise<void>;
  removeItem: (clave: string) => Promise<void>;
};

const claveTrozo = (clave: string, i: number) => `${clave}__${i}`;

function trocear(valor: string): string[] {
  const trozos: string[] = [];
  for (let i = 0; i < valor.length; i += TAMANO_TROZO) {
    trozos.push(valor.slice(i, i + TAMANO_TROZO));
  }
  return trozos.length > 0 ? trozos : [""];
}

export function crearAlmacenSesion(store: ApiSecureStore): AlmacenSesion {
  async function borrarTrozos(clave: string, desde: number, hasta: number) {
    for (let i = desde; i < hasta; i++) {
      await store.deleteItemAsync(claveTrozo(clave, i));
    }
  }

  return {
    async getItem(clave) {
      const indice = await store.getItemAsync(clave);
      if (indice === null) return null;

      const total = Number(indice);
      if (!Number.isInteger(total) || total <= 0) return null;

      const trozos: string[] = [];
      for (let i = 0; i < total; i++) {
        const trozo = await store.getItemAsync(claveTrozo(clave, i));
        // Un trozo perdido deja una sesión a medias: un JWT cortado no es mejor
        // que ninguno — se pide login otra vez.
        if (trozo === null) return null;
        trozos.push(trozo);
      }
      return trozos.join("");
    },

    async setItem(clave, valor) {
      const anterior = Number((await store.getItemAsync(clave)) ?? "0");
      const trozos = trocear(valor);

      for (const [i, trozo] of trozos.entries()) {
        await store.setItemAsync(claveTrozo(clave, i), trozo);
      }
      await store.setItemAsync(clave, String(trozos.length));

      // Si el valor nuevo ocupa menos trozos que el viejo, los sobrantes se
      // quedarían pegados y al leer se concatenaría basura.
      if (Number.isInteger(anterior) && anterior > trozos.length) {
        await borrarTrozos(clave, trozos.length, anterior);
      }
    },

    async removeItem(clave) {
      const total = Number((await store.getItemAsync(clave)) ?? "0");
      if (Number.isInteger(total) && total > 0) {
        await borrarTrozos(clave, 0, total);
      }
      await store.deleteItemAsync(clave);
    },
  };
}
