import { Stack } from "expo-router";
import { useEffect } from "react";
import { SafeAreaView } from "react-native-safe-area-context";

import { IndicadorConexion } from "@/componentes/indicador-conexion";
import { ConectorSupabase } from "@/lib/powersync/conector";
import { db } from "@/lib/powersync/db";
import {
  debeLimpiarReplica,
  guardarUltimoUsuario,
  leerUltimoUsuario,
} from "@/lib/replica-usuario";
import { useSesion } from "@/sesion";
import { colores } from "@/tema";

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
      }
      await guardarUltimoUsuario(id);
      if (cancelado) return;
      await db.connect(new ConectorSupabase());
    }

    conectar(userId).catch((error: unknown) => {
      console.error(
        "PowerSync no pudo conectar: " +
          (error instanceof Error ? error.message : String(error)),
      );
    });

    // Al salir del shell solo se desconecta: los datos se conservan por si vuelve
    // el mismo mercaderista. La limpieza es al ENTRAR, y solo si cambió el usuario.
    return () => {
      cancelado = true;
      void db.disconnect();
    };
  }, [userId]);

  return (
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
  );
}
