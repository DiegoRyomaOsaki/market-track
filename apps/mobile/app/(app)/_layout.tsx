import { PowerSyncContext } from "@powersync/react-native";
import { Stack } from "expo-router";
import { useEffect } from "react";
import { AppState } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { IndicadorConexion } from "@/componentes/indicador-conexion";
import {
  fijarUsuarioDeFotos,
  reconciliarFotos,
  subidorFotos,
} from "@/lib/cola-fotos-instancia";
import { limpiarDispositivo } from "@/lib/limpieza-dispositivo";
import { ConectorSupabase } from "@/lib/powersync/conector";
import { db } from "@/lib/powersync/db";
import {
  debeLimpiarReplica,
  guardarUltimoUsuario,
  leerUltimoUsuario,
} from "@/lib/replica-usuario";
import { useSesion } from "@/sesion";
import { colores } from "@/tema";
import { mensajeDeError } from "@/lib/error";

// El shell autenticado. Solo se llega aquí con sesión aal2 (lo garantiza el guard
// del layout raíz), así que es el sitio para conectar la réplica: PowerSync
// sincroniza mientras el mercaderista está dentro, y se desconecta al salir.
export default function LayoutApp() {
  const sesion = useSesion();
  const userId = sesion?.user.id;

  useEffect(() => {
    if (!userId) return;
    let cancelado = false;

    async function conectar(id: string) {
      // Si el teléfono era de OTRO mercaderista, se limpia su réplica antes de
      // entrar, para que el nuevo usuario no vea datos de otro inquilino (offline
      // no se corrige solo). Si es el mismo que vuelve, se conserva su trabajo.
      const anterior = await leerUltimoUsuario();
      if (debeLimpiarReplica(anterior, id)) {
        await db.disconnectAndClear();
        // Y lo que hay en disco se va con la réplica: si no, quedan ficheros
        // del mercaderista anterior en un teléfono que ya no es su contexto.
        // Qué se borra lo enumera `limpieza-dispositivo`, en un solo sitio.
        await limpiarDispositivo();
      }
      await guardarUltimoUsuario(id);
      if (cancelado) return;
      await db.connect(new ConectorSupabase());
    }

    conectar(userId).catch((error: unknown) => {
      console.error("PowerSync no pudo conectar: " + mensajeDeError(error));
    });

    // Al salir del shell solo se desconecta: los datos se conservan por si vuelve
    // el mismo mercaderista. La limpieza es al ENTRAR, y solo si cambió el usuario.
    return () => {
      cancelado = true;
      void db.disconnect();
    };
  }, [userId]);

  // La cola de fotos hacia R2. Va aparte del efecto de conexión porque no
  // depende de él: la cola se vacía cuando hay señal, la haya traído quien la
  // haya traído.
  useEffect(() => {
    if (!userId) return;
    fijarUsuarioDeFotos(userId);

    // Lo que quedó a medias de una sesión anterior (app muerta entre el PUT y el
    // borrado, manifiesto truncado) vuelve a la cola al entrar.
    void reconciliarFotos(userId)
      .then(() => subidorFotos.arrancar())
      .catch((error: unknown) => {
        console.warn(
          "No se pudo reconciliar la cola de fotos: " + mensajeDeError(error),
        );
      });

    // Al recuperar señal: es el disparador principal, y el mismo evento que ya
    // observa el indicador de conexión — no hace falta `netinfo`.
    const quitarSync = db.registerListener({
      statusChanged: (s) => {
        if (s.connected) void subidorFotos.arrancar();
      },
    });

    // Al volver al primer plano: cubre el teléfono que estuvo guardado.
    const suscripcion = AppState.addEventListener("change", (estado) => {
      if (estado === "active") void subidorFotos.arrancar();
    });

    return () => {
      quitarSync();
      suscripcion.remove();
      subidorFotos.detener();
      fijarUsuarioDeFotos(null);
    };
  }, [userId]);

  return (
    <PowerSyncContext.Provider value={db}>
      <SafeAreaView
        style={{ flex: 1, backgroundColor: colores.fondo }}
        edges={["top"]}
      >
        <IndicadorConexion />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colores.fondo },
          }}
        />
      </SafeAreaView>
    </PowerSyncContext.Provider>
  );
}
