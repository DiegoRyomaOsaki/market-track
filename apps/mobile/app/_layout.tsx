import type { Session } from "@supabase/supabase-js";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StatusBar, View } from "react-native";

import { supabase } from "@/lib/supabase";
import { colores } from "@/tema";
import { SesionContexto } from "@/sesion";

export default function LayoutRaiz() {
  const [sesion, setSesion] = useState<Session | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    // Al abrir la app: la sesión sale del almacén cifrado del teléfono, no de la
    // red. El mercaderista abre la app sin señal y tiene que entrar igual.
    void supabase.auth.getSession().then(({ data }) => {
      setSesion(data.session);
      setCargando(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_evento, s) => {
      setSesion(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (cargando) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colores.fondo,
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={colores.marca} />
      </View>
    );
  }

  return (
    <SesionContexto.Provider value={sesion}>
      <StatusBar barStyle="light-content" backgroundColor={colores.fondo} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colores.fondo },
        }}
      >
        <Stack.Protected guard={sesion !== null}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={sesion === null}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
    </SesionContexto.Provider>
  );
}
