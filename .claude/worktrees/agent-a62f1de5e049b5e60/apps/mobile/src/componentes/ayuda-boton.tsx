import { AYUDA_MERCADERISTA, type ClaveAyuda } from "@market-track/shared";
import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { colores, espacio, radio } from "@/tema";

// El "?" de ayuda contextual: abre un bottom sheet con el contenido empaquetado
// (offline, ver @market-track/shared). Se coloca en cada paso del wizard y en
// check-in/check-out.

export function AyudaBoton({ clave }: { clave: ClaveAyuda }) {
  const [abierto, setAbierto] = useState(false);
  const ayuda = AYUDA_MERCADERISTA[clave];

  return (
    <>
      <Pressable
        onPress={() => setAbierto(true)}
        hitSlop={8}
        style={e.boton}
        accessibilityRole="button"
        accessibilityLabel={`Ayuda: ${ayuda.titulo}`}
      >
        <Text style={e.signo}>?</Text>
      </Pressable>

      <Modal
        visible={abierto}
        animationType="slide"
        transparent
        onRequestClose={() => setAbierto(false)}
      >
        <Pressable style={e.fondo} onPress={() => setAbierto(false)}>
          {/* Detiene el cierre al tocar dentro de la hoja. */}
          <Pressable style={e.hoja} onPress={() => undefined}>
            <View style={e.asa} />
            <Text style={e.titulo}>{ayuda.titulo}</Text>
            <ScrollView style={e.scroll}>
              {ayuda.cuerpo.map((parrafo, i) => (
                <Text key={i} style={e.parrafo}>
                  {parrafo}
                </Text>
              ))}
            </ScrollView>
            <Pressable
              onPress={() => setAbierto(false)}
              style={e.cerrar}
              accessibilityRole="button"
            >
              <Text style={e.cerrarTexto}>Entendido</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const e = StyleSheet.create({
  boton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colores.borde,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colores.superficie,
  },
  signo: { color: colores.textoSuave, fontSize: 16, fontWeight: "800" },
  fondo: { flex: 1, justifyContent: "flex-end", backgroundColor: "#0009" },
  hoja: {
    backgroundColor: colores.superficie,
    borderTopLeftRadius: radio.l,
    borderTopRightRadius: radio.l,
    padding: espacio.l,
    maxHeight: "80%",
  },
  asa: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colores.borde,
    alignSelf: "center",
    marginBottom: espacio.m,
  },
  titulo: { color: colores.texto, fontSize: 20, fontWeight: "800" },
  scroll: { marginTop: espacio.s },
  parrafo: {
    color: colores.textoSuave,
    fontSize: 15,
    lineHeight: 22,
    marginTop: espacio.s,
  },
  cerrar: {
    height: 48,
    borderRadius: radio.m,
    backgroundColor: colores.marca,
    alignItems: "center",
    justifyContent: "center",
    marginTop: espacio.l,
  },
  cerrarTexto: { color: colores.marcaTexto, fontSize: 16, fontWeight: "700" },
});
