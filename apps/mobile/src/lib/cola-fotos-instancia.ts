import * as FileSystem from "expo-file-system/legacy";
import { useEffect, useState } from "react";

import {
  type AlmacenManifiesto,
  ColaFotos,
  type FotoPendiente,
} from "./cola-fotos";

// La cola de fotos de la app, con el manifiesto persistido en el directorio de
// documentos. Persistir importa: una foto encolada sin señal tiene que seguir
// en la cola tras cerrar la app (el diferenciador #1 es el offline real).

const RUTA = `${FileSystem.documentDirectory}cola-fotos.json`;

const almacenDisco: AlmacenManifiesto = {
  async leer() {
    const info = await FileSystem.getInfoAsync(RUTA);
    if (!info.exists) return null;
    return FileSystem.readAsStringAsync(RUTA);
  },
  async escribir(contenido) {
    await FileSystem.writeAsStringAsync(RUTA, contenido);
  },
};

export const colaFotos = new ColaFotos(almacenDisco);

/** El número de fotos pendientes de subir, reactivo. Para el indicador. */
export function useCountFotos(): number {
  const [n, setN] = useState(0);

  useEffect(() => {
    let vivo = true;
    void colaFotos.contarPendientes().then((c) => vivo && setN(c));
    const quitar = colaFotos.suscribir((total) => vivo && setN(total));
    return () => {
      vivo = false;
      quitar();
    };
  }, []);

  return n;
}

/** La lista de fotos pendientes, reactiva. Para la pantalla de sincronización. */
export function useFotosPendientes(): FotoPendiente[] {
  const [fotos, setFotos] = useState<FotoPendiente[]>([]);

  useEffect(() => {
    let vivo = true;
    const refrescar = () =>
      void colaFotos.listarPendientes().then((f) => vivo && setFotos(f));
    refrescar();
    const quitar = colaFotos.suscribir(() => refrescar());
    return () => {
      vivo = false;
      quitar();
    };
  }, []);

  return fotos;
}
