import { Stack } from "expo-router";
import { useEffect } from "react";
import { SafeAreaView } from "react-native-safe-area-context";

import { IndicadorConexion } from "@/componentes/indicador-conexion";
import { ConectorSupabase } from "@/lib/powersync/conector";
import { db } from "@/lib/powersync/db";
import { colores } from "@/tema";

// El shell autenticado. Solo se llega aquí con sesión aal2 (lo garantiza el guard
// del layout raíz), así que es el sitio para conectar la réplica: PowerSync
// sincroniza mientras el mercaderista está dentro, y se desconecta al salir.
export default function LayoutApp() {
  useEffect(() => {
    db.connect(new ConectorSupabase()).catch((error: unknown) => {
      console.error(
        "PowerSync no pudo conectar: " +
          (error instanceof Error ? error.message : String(error)),
      );
    });
    return () => {
      void db.disconnect();
    };
  }, []);

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
