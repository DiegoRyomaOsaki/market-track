import type { PuntoGeo } from "@market-track/shared";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { CamaraFoto } from "@/componentes/camara-foto";
import {
  ContingenciaLink,
  pasoEstilos as p,
  Seccion,
} from "@/componentes/paso-comun";
import { encolarFoto } from "@/lib/cola-fotos-instancia";
import { type FotoCapturada } from "@/lib/foto-captura";
import { ubicacionActual } from "@/lib/ubicacion";
import { colores, espacio } from "@/tema";

// Paso 4.5 (cierre) "Foto Después": la góndola ya trabajada. La miniatura del
// "Antes" como guía queda pendiente hasta que MAR-39 enlace las fotos (hoy la
// foto Antes se encola sin FK, así que no hay de dónde leer su miniatura). La
// foto se encola; su FK queda null hasta MAR-39.

type Props = {
  visitaId: string;
  marcaId: string;
  levantamientoId: string;
  tenantId: string;
  usuario: string;
  onCompletar: () => void;
  onContingencia: () => void;
};

export function PasoDespues({
  visitaId,
  levantamientoId,
  tenantId,
  usuario,
  onCompletar,
  onContingencia,
}: Props) {
  const [foto, setFoto] = useState<FotoCapturada | null>(null);
  const [camara, setCamara] = useState(false);
  const [geo, setGeo] = useState<PuntoGeo | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function abrirCamara() {
    const ubic = await ubicacionActual();
    // Null si el GPS no dio lectura: `0,0` es un punto real en el golfo de
    // Guinea y acabaría guardado como la coordenada de la evidencia.
    setGeo(ubic.ok ? ubic.punto : null);
    setCamara(true);
  }

  async function continuar() {
    if (!foto || guardando) return;
    setGuardando(true);
    try {
      await encolarFoto({
        foto,
        tenantId,
        visitaId,
        levantamientoId,
        tipo: "despues",
      });
      onCompletar();
    } finally {
      setGuardando(false);
    }
  }

  if (camara) {
    return (
      <CamaraFoto
        usuario={usuario}
        lat={geo?.lat ?? null}
        lng={geo?.lng ?? null}
        facing="back"
        etiqueta="Tomar foto Después"
        onListo={(f) => {
          setFoto(f);
          setCamara(false);
        }}
        onCancelar={() => setCamara(false)}
      />
    );
  }

  return (
    <ScrollView
      style={p.scroll}
      contentContainerStyle={p.scrollContenido}
      keyboardShouldPersistTaps="handled"
    >
      <Seccion titulo="Foto Después">
        <View style={p.fila}>
          <View
            style={[
              e.punto,
              {
                backgroundColor: foto ? colores.completado : colores.textoSuave,
              },
            ]}
          />
          <Text style={p.filaTexto}>
            {foto ? "Foto tomada" : "Toma la foto de la góndola ya trabajada"}
          </Text>
        </View>
        <Pressable
          onPress={() => void abrirCamara()}
          style={p.botonSec}
          accessibilityRole="button"
        >
          <Text style={p.botonSecTexto}>
            {foto ? "Repetir foto" : "Abrir cámara"}
          </Text>
        </Pressable>
      </Seccion>

      <Pressable
        onPress={() => void continuar()}
        disabled={!foto || guardando}
        style={[p.boton, (!foto || guardando) && p.botonInactivo]}
        accessibilityRole="button"
      >
        {guardando ? (
          <ActivityIndicator color={colores.marcaTexto} />
        ) : (
          <Text style={p.botonTexto}>Continuar</Text>
        )}
      </Pressable>

      <ContingenciaLink onPress={onContingencia} />
    </ScrollView>
  );
}

const e = StyleSheet.create({
  punto: { width: 10, height: 10, borderRadius: 5, marginRight: espacio.xs },
});
