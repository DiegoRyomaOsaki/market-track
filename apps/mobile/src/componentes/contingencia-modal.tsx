import * as Crypto from "expo-crypto";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { CamaraFoto } from "@/componentes/camara-foto";
import { colaFotos } from "@/lib/cola-fotos-instancia";
import { type FotoProcesada } from "@/lib/foto-captura";
import { registrarContingencia } from "@/lib/levantamiento";
import type { PasoBypass } from "@/lib/pasos-levantamiento";
import { ubicacionActual } from "@/lib/ubicacion";
import { colores, espacio, radio } from "@/tema";

// El flujo de contingencia (bypass) de un paso del levantamiento: "No puedo
// completar este paso" → motivo OBLIGATORIO → foto opcional → continuar. Inserta
// la fila `contingencia` en la réplica local; el trigger del servidor (MAR-28)
// dispara la alerta al supervisor al sincronizar. Sin este flujo se incumple la
// propuesta aceptada.

type Props = {
  visible: boolean;
  paso: PasoBypass;
  // El id del paso configurable omitido (null en los pasos fijos).
  pasoConfigId: string | null;
  tituloPaso: string;
  usuario: string;
  tenant_id: string;
  visita_id: string;
  levantamiento_id: string;
  onRegistrada: () => void;
  onCancelar: () => void;
};

export function ContingenciaModal({
  visible,
  paso,
  pasoConfigId,
  tituloPaso,
  usuario,
  tenant_id,
  visita_id,
  levantamiento_id,
  onRegistrada,
  onCancelar,
}: Props) {
  const [modo, setModo] = useState<"form" | "camara">("form");
  const [motivo, setMotivo] = useState("");
  const [foto, setFoto] = useState<FotoProcesada | null>(null);
  const [geo, setGeo] = useState<{ lat: number; lng: number }>({
    lat: 0,
    lng: 0,
  });
  const [guardando, setGuardando] = useState(false);

  function cerrar() {
    setModo("form");
    setMotivo("");
    setFoto(null);
    setGuardando(false);
    onCancelar();
  }

  async function abrirCamara() {
    const ubic = await ubicacionActual();
    if (ubic.ok) setGeo({ lat: ubic.punto.lat, lng: ubic.punto.lng });
    setModo("camara");
  }

  async function registrar() {
    const texto = motivo.trim();
    if (!texto || guardando) return;
    setGuardando(true);
    try {
      let fotoId: string | null = null;
      if (foto) {
        fotoId = Crypto.randomUUID();
        await colaFotos.encolar({
          id: fotoId,
          ruta: foto.ruta,
          hash: foto.hash,
          encolada_at: new Date().toISOString(),
        });
      }
      await registrarContingencia({
        tenant_id,
        visita_id,
        levantamiento_id,
        paso,
        paso_config_id: pasoConfigId,
        motivo: texto,
        comentario: null,
        foto_id: fotoId,
      });
      setModo("form");
      setMotivo("");
      setFoto(null);
      onRegistrada();
    } finally {
      setGuardando(false);
    }
  }

  if (modo === "camara") {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={cerrar}>
        <CamaraFoto
          usuario={usuario}
          lat={geo.lat}
          lng={geo.lng}
          facing="back"
          etiqueta="Tomar foto del hallazgo"
          onListo={(f) => {
            setFoto(f);
            setModo("form");
          }}
          onCancelar={() => setModo("form")}
        />
      </Modal>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={cerrar}
    >
      <KeyboardAvoidingView
        style={e.fondo}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={e.hoja}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={e.titulo}>No puedo completar este paso</Text>
            <Text style={e.paso}>{tituloPaso}</Text>
            <Text style={e.nota}>
              El paso quedará marcado como omitido y tu supervisor recibirá una
              alerta. Explica por qué no pudiste completarlo.
            </Text>

            <Text style={e.etiqueta}>Motivo (obligatorio)</Text>
            <TextInput
              value={motivo}
              onChangeText={setMotivo}
              placeholder="Sin acceso al almacén, información no disponible…"
              placeholderTextColor={colores.textoSuave}
              style={e.input}
              multiline
              accessibilityLabel="Motivo de la contingencia"
            />

            <Pressable
              onPress={() => void abrirCamara()}
              style={e.botonSec}
              accessibilityRole="button"
            >
              <Text style={e.botonSecTexto}>
                {foto ? "Repetir foto (opcional)" : "Adjuntar foto (opcional)"}
              </Text>
            </Pressable>
            {foto ? <Text style={e.fotoOk}>✓ Foto adjunta</Text> : null}

            <Pressable
              onPress={() => void registrar()}
              disabled={!motivo.trim() || guardando}
              style={[
                e.boton,
                (!motivo.trim() || guardando) && e.botonInactivo,
              ]}
              accessibilityRole="button"
            >
              {guardando ? (
                <ActivityIndicator color={colores.marcaTexto} />
              ) : (
                <Text style={e.botonTexto}>Registrar y continuar</Text>
              )}
            </Pressable>

            <Pressable
              onPress={cerrar}
              style={e.cancelar}
              accessibilityRole="button"
            >
              <Text style={e.cancelarTexto}>Volver al paso</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const e = StyleSheet.create({
  fondo: { flex: 1, justifyContent: "flex-end", backgroundColor: "#0009" },
  hoja: {
    backgroundColor: colores.superficie,
    borderTopLeftRadius: radio.l,
    borderTopRightRadius: radio.l,
    padding: espacio.l,
    maxHeight: "88%",
  },
  titulo: { color: colores.texto, fontSize: 20, fontWeight: "800" },
  paso: {
    color: colores.marca,
    fontSize: 14,
    fontWeight: "700",
    marginTop: espacio.xs,
  },
  nota: {
    color: colores.textoSuave,
    fontSize: 14,
    lineHeight: 20,
    marginTop: espacio.s,
  },
  etiqueta: {
    color: colores.textoSuave,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: espacio.l,
    marginBottom: espacio.xs,
  },
  input: {
    backgroundColor: colores.fondo,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    color: colores.texto,
    fontSize: 15,
    padding: espacio.m,
    minHeight: 88,
    textAlignVertical: "top",
  },
  fotoOk: {
    color: colores.completado,
    fontSize: 14,
    fontWeight: "600",
    marginTop: espacio.xs,
  },
  boton: {
    height: 52,
    borderRadius: radio.m,
    backgroundColor: colores.marca,
    alignItems: "center",
    justifyContent: "center",
    marginTop: espacio.l,
  },
  botonInactivo: { opacity: 0.4 },
  botonTexto: { color: colores.marcaTexto, fontSize: 16, fontWeight: "700" },
  botonSec: {
    height: 46,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    alignItems: "center",
    justifyContent: "center",
    marginTop: espacio.m,
  },
  botonSecTexto: { color: colores.texto, fontSize: 15, fontWeight: "600" },
  cancelar: { alignItems: "center", paddingVertical: espacio.m },
  cancelarTexto: { color: colores.textoSuave, fontSize: 15, fontWeight: "600" },
});
