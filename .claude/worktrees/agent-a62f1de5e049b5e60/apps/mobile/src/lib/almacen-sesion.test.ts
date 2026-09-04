import { describe, expect, it } from "@jest/globals";

import { crearAlmacenSesion, type ApiSecureStore } from "./almacen-sesion";

/**
 * Bytes UTF-8 de una cadena, a mano.
 *
 * `TextEncoder` vive en la lib DOM, y este workspace no la carga: meter tipos de
 * navegador en React Native invita a escribir `document.…` en una app que no
 * tiene DOM. El límite de SecureStore se mide en BYTES, no en caracteres — un
 * acento ocupa dos.
 */
function bytesUtf8(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

// Un doble de SecureStore que se comporta como el iOS real: RECHAZA lo que pase de
// 2048 bytes. Sin esto, el test pasaría con un Map y el bug llegaría al teléfono.
function secureStoreFalso(limiteBytes = 2048): ApiSecureStore & {
  claves: () => string[];
} {
  const datos = new Map<string, string>();
  return {
    getItemAsync: (k) => Promise.resolve(datos.get(k) ?? null),
    setItemAsync: (k, v) => {
      if (bytesUtf8(v) > limiteBytes) {
        return Promise.reject(new Error("payload too large"));
      }
      datos.set(k, v);
      return Promise.resolve();
    },
    deleteItemAsync: (k) => {
      datos.delete(k);
      return Promise.resolve();
    },
    claves: () => [...datos.keys()],
  };
}

const SESION_GRANDE = JSON.stringify({
  access_token: "a".repeat(1200),
  refresh_token: "r".repeat(600),
  user: { id: "u".repeat(400) },
});

describe("crearAlmacenSesion", () => {
  it("guarda y devuelve una sesión que NO cabe en un solo valor", async () => {
    // El caso real: una sesión de Supabase pasa de 2 KB.
    expect(bytesUtf8(SESION_GRANDE)).toBeGreaterThan(2048);

    const store = secureStoreFalso();
    const almacen = crearAlmacenSesion(store);

    await almacen.setItem("sesion", SESION_GRANDE);
    expect(await almacen.getItem("sesion")).toBe(SESION_GRANDE);
  });

  it("una clave que nunca se guardó devuelve null, no revienta", async () => {
    const almacen = crearAlmacenSesion(secureStoreFalso());
    expect(await almacen.getItem("no-existe")).toBeNull();
  });

  it("guarda y devuelve un valor pequeño y con acentos", async () => {
    const almacen = crearAlmacenSesion(secureStoreFalso());
    await almacen.setItem("k", "José Quispe · ñandú");
    expect(await almacen.getItem("k")).toBe("José Quispe · ñandú");
  });

  it("al borrar no deja ningún trozo huérfano", async () => {
    const store = secureStoreFalso();
    const almacen = crearAlmacenSesion(store);

    await almacen.setItem("sesion", SESION_GRANDE);
    await almacen.removeItem("sesion");

    expect(await almacen.getItem("sesion")).toBeNull();
    expect(store.claves()).toEqual([]);
  });

  it("al reemplazar por algo más corto no quedan trozos viejos pegados", async () => {
    // El bug clásico del troceado: la sesión nueva ocupa 2 trozos, la vieja 3, y
    // el trozo #3 sobrevive. Al leer se concatena basura y la sesión no parsea.
    const store = secureStoreFalso();
    const almacen = crearAlmacenSesion(store);

    await almacen.setItem("sesion", SESION_GRANDE);
    await almacen.setItem("sesion", "corta");

    expect(await almacen.getItem("sesion")).toBe("corta");
    expect(store.claves().length).toBe(2); // índice + un solo trozo
  });

  it("si un trozo se pierde, devuelve null en vez de una sesión a medias", async () => {
    // Media sesión no es una sesión: mejor pedir login que entregar un JWT roto.
    const store = secureStoreFalso();
    const almacen = crearAlmacenSesion(store);
    await almacen.setItem("sesion", SESION_GRANDE);

    await store.deleteItemAsync("sesion__1");

    expect(await almacen.getItem("sesion")).toBeNull();
  });
});
