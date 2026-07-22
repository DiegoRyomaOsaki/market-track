import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { captureRef } from "react-native-view-shot";

import {
  type FotoProcesada,
  lineasWatermark,
  procesarFoto,
} from "@/lib/foto-captura";
import { colores, espacio, radio } from "@/tema";

// La selfie del check-in. El watermark (hora + coords + usuario) se GRABA en el
// pixel: se renderiza la foto con el texto encima y se aplana con captureRef, así
// la marca viaja dentro de la imagen y no se puede quitar (ADR-0006). Solo cámara
// en vivo — la galería está bloqueada a propósito.

type Props = {
  usuario: string;
  lat: number;
  lng: number;
  onListo: (foto: FotoProcesada) => void;
  onCancelar: () => void;
};

export function CamaraSelfie({
  usuario,
  lat,
  lng,
  onListo,
  onCancelar,
}: Props) {
  const [permiso, pedirPermiso] = useCameraPermissions();
  const camaraRef = useRef<CameraView>(null);
  const marcoRef = useRef<View>(null);
  const [rawUri, setRawUri] = useState<string | null>(null);
  const [capturadoAt, setCapturadoAt] = useState("");
  const [procesando, setProcesando] = useState(false);

  if (!permiso) {
    return (
      <View style={e.centro}>
        <ActivityIndicator color={colores.marca} />
      </View>
    );
  }

  if (!permiso.granted) {
    return (
      <View style={e.centro}>
        <Text style={e.aviso}>
          Market Track necesita la cámara para la selfie de check-in.
        </Text>
        <Pressable
          onPress={() => void pedirPermiso()}
          style={e.boton}
          accessibilityRole="button"
        >
          <Text style={e.botonTexto}>Dar permiso</Text>
        </Pressable>
      </View>
    );
  }

  async function tomar() {
    const foto = await camaraRef.current?.takePictureAsync({ quality: 0.9 });
    if (foto?.uri) {
      // La hora se sella en la captura, no al subir.
      setCapturadoAt(new Date().toISOString());
      setRawUri(foto.uri);
    }
  }

  async function confirmar() {
    if (!marcoRef.current) return;
    setProcesando(true);
    try {
      const plana = await captureRef(marcoRef, { format: "jpg", quality: 0.9 });
      onListo(await procesarFoto(plana));
    } finally {
      setProcesando(false);
    }
  }

  const lineas = rawUri
    ? lineasWatermark({ capturado_at: capturadoAt, lat, lng, usuario })
    : [];

  return (
    <View style={e.pantalla}>
      {rawUri ? (
        <View ref={marcoRef} collapsable={false} style={e.preview}>
          <Image
            source={{ uri: rawUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
          <View style={e.watermark}>
            {lineas.map((l) => (
              <Text key={l} style={e.wmTexto}>
                {l}
              </Text>
            ))}
          </View>
        </View>
      ) : (
        <CameraView ref={camaraRef} style={e.preview} facing="front" />
      )}

      <View style={e.barra}>
        {rawUri ? (
          <>
            <Pressable
              onPress={() => setRawUri(null)}
              disabled={procesando}
              style={e.botonSec}
              accessibilityRole="button"
            >
              <Text style={e.botonSecTexto}>Repetir</Text>
            </Pressable>
            <Pressable
              onPress={() => void confirmar()}
              disabled={procesando}
              style={e.boton}
              accessibilityRole="button"
            >
              {procesando ? (
                <ActivityIndicator color={colores.marcaTexto} />
              ) : (
                <Text style={e.botonTexto}>Usar foto</Text>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={onCancelar}
              style={e.botonSec}
              accessibilityRole="button"
            >
              <Text style={e.botonSecTexto}>Cancelar</Text>
            </Pressable>
            <Pressable
              onPress={() => void tomar()}
              style={e.boton}
              accessibilityRole="button"
            >
              <Text style={e.botonTexto}>Tomar selfie</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const e = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: "#000" },
  preview: { flex: 1, position: "relative" },
  centro: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: espacio.xl,
    gap: espacio.l,
    backgroundColor: colores.fondo,
  },
  aviso: {
    color: colores.texto,
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  watermark: {
    position: "absolute",
    left: espacio.m,
    bottom: espacio.m,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: radio.s,
    paddingHorizontal: espacio.s,
    paddingVertical: espacio.xs,
    gap: 1,
  },
  wmTexto: { color: "#fff", fontSize: 12, fontWeight: "600" },
  barra: {
    flexDirection: "row",
    gap: espacio.m,
    padding: espacio.m,
    backgroundColor: colores.fondo,
  },
  boton: {
    flex: 1,
    height: 50,
    borderRadius: radio.m,
    backgroundColor: colores.marca,
    alignItems: "center",
    justifyContent: "center",
  },
  botonTexto: { color: colores.marcaTexto, fontSize: 16, fontWeight: "700" },
  botonSec: {
    flex: 1,
    height: 50,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    alignItems: "center",
    justifyContent: "center",
  },
  botonSecTexto: { color: colores.texto, fontSize: 16, fontWeight: "600" },
});
