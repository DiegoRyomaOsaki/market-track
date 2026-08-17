import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { esAal2 } from "@/lib/aal";
import { supabase } from "@/lib/supabase";
import { calcularVentana, guardarVentana } from "@/lib/recordar-dispositivo";
import { factorUsable, type PasoLogin } from "@/lib/segundo-factor";
import { colores, espacio, radio } from "@/tema";

/**
 * Acceso del mercaderista con segundo factor (ADR-0008 / MAR-34).
 *
 * Tres pasos: contraseña → (enrolar teléfono si falta) → código. El código llega
 * por correo vía el hook `send_sms`, aunque el factor sea de tipo Teléfono.
 *
 * El login es el ÚNICO flujo que hace red a propósito: sin conexión no se puede
 * autenticar. Los flujos de campo (Mi día, check-in…) leen de la réplica local.
 *
 * "No me llegó el código" → el pase de acceso temporal, en el mismo campo: lo
 * canjea la Edge Function `canjear-pase` y la sesión sube a `aal2` al refrescarse
 * (el hook de GoTrue eleva el claim; ADR-0008). Sin OTP, pero sin abrir otra
 * puerta: la app sigue entrando solo con `aal2`.
 */
export default function Login() {
  const [paso, setPaso] = useState<PasoLogin>("credenciales");
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");
  const [telefono, setTelefono] = useState("");
  const [codigo, setCodigo] = useState("");
  const [recordar, setRecordar] = useState(true);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const router = useRouter();

  /** Pide el código a Supabase; el hook lo entrega por el canal del usuario. */
  async function pedirCodigo(fid: string) {
    setFactorId(fid);
    const { data, error: e } = await supabase.auth.mfa.challenge({
      factorId: fid,
    });
    if (e || !data) {
      setError("No pudimos enviarte el código. Inténtalo de nuevo.");
      return false;
    }
    setChallengeId(data.id);
    setPaso("codigo");
    return true;
  }

  /** ¿Ya tiene factor? Al código; si no, a enrolar el teléfono. */
  async function continuar2fa() {
    const { data, error: e } = await supabase.auth.mfa.listFactors();
    if (e || !data) {
      setError("No pudimos comprobar tu segundo factor.");
      return;
    }
    const usable = factorUsable(data.all);
    if (!usable) {
      setPaso("telefono");
      return;
    }
    await pedirCodigo(usable.id);
  }

  async function entrar() {
    setOcupado(true);
    setError(null);
    const { error: fallo } = await supabase.auth.signInWithPassword({
      email: correo.trim(),
      password: clave,
    });
    if (fallo) {
      // Mensaje único: no se le dice a nadie qué correos existen.
      setError("Correo o contraseña incorrectos.");
      setOcupado(false);
      return;
    }
    await continuar2fa();
    setOcupado(false);
  }

  async function enrolar() {
    setOcupado(true);
    setError(null);
    const { data, error: fallo } = await supabase.auth.mfa.enroll({
      factorType: "phone",
      phone: telefono.trim(),
    });
    if (fallo || !data) {
      setError("No pudimos registrar ese número. Revisa el formato (+51…).");
      setOcupado(false);
      return;
    }
    await pedirCodigo(data.id);
    setOcupado(false);
  }

  /** Con la sesión ya en aal2: recordar el dispositivo y entrar. */
  async function entrarConSegundoFactor() {
    // La sesión aal2 se retiene al refrescarse: recordar el dispositivo es no
    // volver a pedir el 2FA mientras la ventana siga viva.
    await guardarVentana(calcularVentana(Date.now(), recordar));
    router.replace("/");
  }

  async function verificar() {
    if (!factorId || !challengeId) return;
    setOcupado(true);
    setError(null);
    const { error: fallo } = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code: codigo.trim(),
    });
    if (fallo) {
      setError("El código no es válido o ya venció.");
      setOcupado(false);
      return;
    }
    await entrarConSegundoFactor();
  }

  /**
   * Canjea el pase que dictó el supervisor. La función marca el pase como usado
   * por ESTA sesión; el token que la app tiene sigue siendo aal1 hasta que se
   * refresca — de ahí el `refreshSession` antes de mirar el claim.
   */
  async function canjearPase() {
    setOcupado(true);
    setError(null);
    const respuesta = await supabase.functions.invoke<{ pase_id: string }>(
      "canjear-pase",
      { body: { codigo: codigo.trim() } },
    );
    // El SDK tipa `error` como `any`: anotarlo `unknown` corta el contagio.
    const fallo: unknown = respuesta.error;
    if (fallo) {
      setError("El pase no es válido o ya no está vigente.");
      setOcupado(false);
      return;
    }
    const { data, error: errRefresco } = await supabase.auth.refreshSession();
    if (errRefresco || !esAal2(data.session?.access_token)) {
      setError("No pudimos activar el pase. Inténtalo de nuevo.");
      setOcupado(false);
      return;
    }
    await entrarConSegundoFactor();
  }

  /** Cambia entre el código por correo y el pase: mismo campo, se vacía. */
  function cambiarPaso(siguiente: PasoLogin) {
    setCodigo("");
    setError(null);
    setPaso(siguiente);
  }

  const accion =
    paso === "credenciales"
      ? entrar
      : paso === "telefono"
        ? enrolar
        : paso === "pase"
          ? canjearPase
          : verificar;

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
        <Text style={e.subtitulo}>{subtituloDe(paso)}</Text>
      </View>

      {paso === "credenciales" && (
        <>
          <Campo etiqueta="Correo">
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
          </Campo>
          <Campo etiqueta="Contraseña">
            <TextInput
              value={clave}
              onChangeText={setClave}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              style={e.input}
              accessibilityLabel="Contraseña"
            />
          </Campo>
        </>
      )}

      {paso === "telefono" && (
        <Campo etiqueta="Teléfono">
          <TextInput
            value={telefono}
            onChangeText={setTelefono}
            keyboardType="phone-pad"
            placeholder="+51999888777"
            autoComplete="tel"
            style={e.input}
            placeholderTextColor={colores.textoSuave}
            accessibilityLabel="Teléfono"
          />
          <Text style={e.ayuda}>
            Lo necesitamos para activar el segundo factor. El código te llegará
            por correo.
          </Text>
        </Campo>
      )}

      {(paso === "codigo" || paso === "pase") && (
        <>
          <Campo etiqueta={paso === "pase" ? "Pase de acceso" : "Código"}>
            <TextInput
              value={codigo}
              onChangeText={setCodigo}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              maxLength={6}
              style={[e.input, e.inputCodigo]}
              accessibilityLabel={
                paso === "pase"
                  ? "Pase de acceso de 6 dígitos"
                  : "Código de 6 dígitos"
              }
            />
          </Campo>
          <View style={e.recordar}>
            <Switch
              value={recordar}
              onValueChange={setRecordar}
              accessibilityLabel="Recordar este dispositivo por 30 días"
            />
            <Text style={e.recordarTexto}>
              Recordar este dispositivo 30 días
            </Text>
          </View>
          {paso === "codigo" ? (
            <>
              <Pressable
                onPress={() => void (factorId && pedirCodigo(factorId))}
                accessibilityRole="button"
              >
                <Text style={e.reenviar}>Reenviar código</Text>
              </Pressable>
              <Pressable
                onPress={() => cambiarPaso("pase")}
                accessibilityRole="button"
              >
                <Text style={e.reenviar}>
                  No me llegó el código: usar un pase de acceso
                </Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              onPress={() => cambiarPaso("codigo")}
              accessibilityRole="button"
            >
              <Text style={e.reenviar}>Volver al código por correo</Text>
            </Pressable>
          )}
        </>
      )}

      {error !== null && (
        <Text style={e.error} accessibilityRole="alert">
          {error}
        </Text>
      )}

      <Pressable
        onPress={() => void accion()}
        disabled={ocupado}
        accessibilityRole="button"
        style={({ pressed }) => [
          e.boton,
          (pressed || ocupado) && e.botonPulsado,
        ]}
      >
        {ocupado ? (
          <ActivityIndicator color={colores.marcaTexto} />
        ) : (
          <Text style={e.botonTexto}>{botonDe(paso)}</Text>
        )}
      </Pressable>
    </KeyboardAvoidingView>
  );
}

function Campo({
  etiqueta,
  children,
}: {
  etiqueta: string;
  children: React.ReactNode;
}) {
  return (
    <View style={e.campo}>
      <Text style={e.etiqueta}>{etiqueta}</Text>
      {children}
    </View>
  );
}

function subtituloDe(paso: PasoLogin): string {
  if (paso === "credenciales") return "Ingresa para ver tu rutero de hoy";
  if (paso === "telefono") return "Activa tu segundo factor";
  if (paso === "pase") {
    return "Ingresa el pase de acceso que te dictó tu supervisor";
  }
  return "Te enviamos un código de 6 dígitos por correo";
}

function botonDe(paso: PasoLogin): string {
  if (paso === "credenciales") return "Continuar";
  if (paso === "telefono") return "Enviarme el código";
  if (paso === "pase") return "Entrar con el pase";
  return "Entrar";
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
  subtitulo: {
    color: colores.textoSuave,
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: espacio.m,
  },
  campo: { gap: espacio.xs },
  etiqueta: { color: colores.textoSuave, fontSize: 13, fontWeight: "600" },
  ayuda: { color: colores.textoSuave, fontSize: 12 },
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
  inputCodigo: { fontFamily: "monospace", letterSpacing: 8, fontSize: 22 },
  recordar: { flexDirection: "row", alignItems: "center", gap: espacio.s },
  recordarTexto: { color: colores.textoSuave, fontSize: 13 },
  reenviar: { color: colores.textoSuave, fontSize: 13, fontWeight: "600" },
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
