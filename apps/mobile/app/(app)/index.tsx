import { Pressable, StyleSheet, Text, View } from "react-native";

import { supabase } from "@/lib/supabase";
import { useSesion } from "@/sesion";
import { colores, espacio, radio } from "@/tema";

/**
 * La pantalla autenticada mínima de este ticket: prueba que la sesión persiste y
 * que se puede salir. "Mi día" (el rutero real) es MAR-35.
 */
export default function Inicio() {
  const sesion = useSesion();

  return (
    <View style={e.pantalla}>
      <Text style={e.saludo}>Hola</Text>
      <Text style={e.correo}>{sesion?.user.email ?? "—"}</Text>
      <Text style={e.nota}>Tu rutero aparecerá aquí cuando esté listo.</Text>

      <Pressable
        onPress={() => void supabase.auth.signOut()}
        accessibilityRole="button"
        style={({ pressed }) => [e.boton, pressed && { opacity: 0.7 }]}
      >
        <Text style={e.botonTexto}>Cerrar sesión</Text>
      </Pressable>
    </View>
  );
}

const e = StyleSheet.create({
  pantalla: {
    flex: 1,
    backgroundColor: colores.fondo,
    justifyContent: "center",
    alignItems: "center",
    padding: espacio.l,
    gap: espacio.s,
  },
  saludo: { color: colores.texto, fontSize: 28, fontWeight: "700" },
  correo: { color: colores.textoSuave, fontSize: 15 },
  nota: {
    color: colores.textoSuave,
    fontSize: 13,
    textAlign: "center",
    marginTop: espacio.m,
  },
  boton: {
    marginTop: espacio.xl,
    height: 46,
    paddingHorizontal: espacio.l,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    alignItems: "center",
    justifyContent: "center",
  },
  botonTexto: { color: colores.texto, fontSize: 15, fontWeight: "600" },
});
