import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { supabase } from "@/lib/supabase";
import { colores, espacio, radio } from "@/tema";

/**
 * Acceso del mercaderista.
 *
 * Alcance de este ticket: contraseña y entrar. El SEGUNDO FACTOR, el canje del
 * pase de acceso temporal y el recordado de dispositivo son MAR-34: aquí la
 * sesión se queda en aal1 a propósito, y no lee datos protegidos todavía.
 */
export default function Login() {
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  const router = useRouter();

  async function entrar() {
    setEntrando(true);
    setError(null);
    const { error: fallo } = await supabase.auth.signInWithPassword({
      email: correo.trim(),
      password: clave,
    });
    setEntrando(false);
    if (fallo) {
      // Mensaje genérico a propósito: distinguir "no existe" de "clave mala"
      // le dice a cualquiera qué correos están dados de alta.
      setError("No pudimos entrar. Revisa tus datos.");
      return;
    }
    router.replace("/");
  }

  return (
    <KeyboardAvoidingView
      style={e.pantalla}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={e.marca}>
        <View style={e.logo}>
          <Text style={e.logoTexto}>M</Text>
        </View>
        <Text style={e.titulo}>Market Track</Text>
        <Text style={e.subtitulo}>Ingresa para ver tu rutero de hoy</Text>
      </View>

      <View style={e.campo}>
        <Text style={e.etiqueta}>Correo</Text>
        <TextInput
          value={correo}
          onChangeText={setCorreo}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          inputMode="email"
          style={e.input}
          placeholderTextColor={colores.textoSuave}
          accessibilityLabel="Correo"
        />
      </View>

      <View style={e.campo}>
        <Text style={e.etiqueta}>Contraseña</Text>
        <TextInput
          value={clave}
          onChangeText={setClave}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          style={e.input}
          accessibilityLabel="Contraseña"
        />
      </View>

      {error !== null && (
        <Text style={e.error} accessibilityRole="alert">
          {error}
        </Text>
      )}

      <Pressable
        onPress={() => void entrar()}
        disabled={entrando}
        accessibilityRole="button"
        style={({ pressed }) => [
          e.boton,
          (pressed || entrando) && e.botonPulsado,
        ]}
      >
        {entrando ? (
          <ActivityIndicator color={colores.marcaTexto} />
        ) : (
          <Text style={e.botonTexto}>Iniciar sesión</Text>
        )}
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const e = StyleSheet.create({
  pantalla: {
    flex: 1,
    backgroundColor: colores.fondo,
    justifyContent: "center",
    padding: espacio.l,
    gap: espacio.m,
  },
  marca: { alignItems: "center", gap: espacio.s, marginBottom: espacio.l },
  logo: {
    width: 64,
    height: 64,
    borderRadius: radio.l,
    backgroundColor: colores.marca,
    alignItems: "center",
    justifyContent: "center",
  },
  logoTexto: { color: colores.marcaTexto, fontSize: 30, fontWeight: "700" },
  titulo: { color: colores.texto, fontSize: 26, fontWeight: "700" },
  subtitulo: { color: colores.textoSuave, fontSize: 14 },
  campo: { gap: espacio.xs },
  etiqueta: { color: colores.textoSuave, fontSize: 13, fontWeight: "600" },
  input: {
    height: 50,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.superficie,
    color: colores.texto,
    paddingHorizontal: espacio.m,
    fontSize: 16,
  },
  error: { color: colores.alerta, fontSize: 13, fontWeight: "600" },
  boton: {
    height: 52,
    borderRadius: radio.m,
    backgroundColor: colores.marca,
    alignItems: "center",
    justifyContent: "center",
    marginTop: espacio.s,
  },
  botonPulsado: { opacity: 0.7 },
  botonTexto: { color: colores.marcaTexto, fontSize: 16, fontWeight: "700" },
});
