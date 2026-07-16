import { Stack } from "expo-router";

import { colores } from "@/tema";

export default function LayoutApp() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colores.fondo },
      }}
    />
  );
}
