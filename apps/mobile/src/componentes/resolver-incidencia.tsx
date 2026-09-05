import { ACCIONES_TOMADAS, type PuntoGeo } from "@market-track/shared";
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
import { mensajeDeError } from "@/lib/error";
import { type FotoCapturada } from "@/lib/foto-captura";
import {
  describirIncidencia,
  type IncidenciaLocal,
  noPuedoResolver,
  resolverIncidencia,
} from "@/lib/incidencias";
import { ubicacionActual } from "@/lib/ubicacion";
import { colores, espacio, radio } from "@/tema";

// Atender una incidencia: qué acción se tomó, con su foto — o por qué no se
// pudo.
//
// Sabino lo describió entero: "no solo que hubo incidencia, sino que tú tomaste
// acción. Sale ahí y te dice: ¿qué acción tomaste? Cambié el precio, hablé con
// el supervisor y lo corrigieron. Y tomas la foto final, porque hay un antes y
// un después. Eso es lo que va a valorar más el cliente."
//
// La foto es obligatoria para RESOLVER, y la verja está aquí y no en la base a
// propósito: un CHECK haría que cualquier PATCH parcial futuro muriera con un
// 23514, y el conector clasifica ese error como permanente y descarta la
// operación — perdiendo el trabajo del mercaderista en silencio.

export function ResolverIncidencia({
  incidencia,
  visible,
  tenantId,
  usuario,
  onAtendida,
  onCancelar,
}: {
  incidencia: IncidenciaLocal;
  visible: boolean;
  tenantId: string;
  usuario: string;
  onAtendida: () => void;
  onCancelar: () => void;
}) {
  const [modo, setModo] = useState<"resolver" | "no_puedo" | "camara">(
    "resolver",
  );
  const [accion, setAccion] = useState("");
  const [motivo, setMotivo] = useState("");
  const [foto, setFoto] = useState<FotoCapturada | null>(null);
  const [geo, setGeo] = useState<PuntoGeo | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cerrar() {
    setModo("resolver");
    setAccion("");
    setMotivo("");
    setFoto(null);
    setError(null);
    setGuardando(false);
    onCancelar();
  }

  async function abrirCamara() {
    const ubic = await ubicacionActual();
    // Null si el GPS no dio lectura: `0,0` es un punto real en el golfo de
    // Guinea y acabaría guardado como la coordenada de la evidencia.
    setGeo(ubic.ok ? ubic.punto : null);
    setModo("camara");
  }

  const puedeResolver = accion.trim().length > 0 && foto !== null && !guardando;

  async function resolver() {
    if (!puedeResolver || !foto) return;
    setGuardando(true);
    setError(null);
    try {
      await resolverIncidencia({
        hallazgo: incidencia,
        tenantId,
        accionTomada: accion.trim(),
        foto,
      });
      console.info(
        `[incidencias] resuelta ${incidencia.id} origen=${incidencia.origen}`,
      );
      cerrar();
      onAtendida();
    } catch (err: unknown) {
      // El modal NO se cierra: si se cerrara, el mercaderista creería que quedó
      // guardado y la incidencia seguiría pendiente sin que él lo supiera.
      setError(mensajeDeError(err));
      setGuardando(false);
    }
  }

  async function noPuedo() {
    const texto = motivo.trim();
    if (!texto || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      await noPuedoResolver({ hallazgo: incidencia, tenantId, motivo: texto });
      cerrar();
      onAtendida();
    } catch (err: unknown) {
      setError(mensajeDeError(err));
      setGuardando(false);
    }
  }

  if (modo === "camara") {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={cerrar}>
        <CamaraFoto
          usuario={usuario}
          lat={geo?.lat ?? null}
          lng={geo?.lng ?? null}
          facing="back"
          etiqueta="Tomar la foto del después"
          onListo={(f) => {
            setFoto(f);
            setModo("resolver");
          }}
          onCancelar={() => setModo("resolver")}
        />
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={cerrar}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={e.pantalla}
      >
        <ScrollView contentContainerStyle={e.contenido}>
          <Text style={e.titulo}>
            {incidencia.sku_nombre ?? incidencia.marca_nombre ?? "Incidencia"}
          </Text>
          <Text style={e.descripcion}>
            {describirIncidencia(incidencia.origen, incidencia.detalle)}
          </Text>

          {modo === "resolver" ? (
            <>
              <Text style={e.etiqueta}>¿Qué acción tomaste?</Text>
              {/* Las frases rellenan el campo y quedan editables: elegir una no
                  impide contar lo que de verdad pasó. */}
              <View style={e.sugerencias}>
                {ACCIONES_TOMADAS.map((sugerencia) => (
                  <Pressable
                    key={sugerencia}
                    onPress={() => setAccion(sugerencia)}
                    accessibilityRole="button"
                    style={e.pastilla}
                  >
                    <Text style={e.pastillaTexto}>{sugerencia}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={accion}
                onChangeText={setAccion}
                placeholder="Escribe la acción que tomaste"
                placeholderTextColor={colores.textoSuave}
                multiline
                maxLength={500}
                accessibilityLabel="Acción tomada"
                style={e.input}
              />

              <Pressable
                onPress={() => void abrirCamara()}
                accessibilityRole="button"
                style={e.botonSecundario}
              >
                <Text style={e.botonSecundarioTexto}>
                  {foto
                    ? "✓ Foto tomada — repetir"
                    : "Tomar la foto del después"}
                </Text>
              </Pressable>
              {!foto ? (
                <Text style={e.nota}>
                  La foto es obligatoria: es la prueba del antes y el después.
                </Text>
              ) : null}

              {error ? <Text style={e.error}>{error}</Text> : null}

              <Pressable
                onPress={() => void resolver()}
                disabled={!puedeResolver}
                accessibilityRole="button"
                accessibilityState={{ disabled: !puedeResolver }}
                style={[e.boton, !puedeResolver && e.botonApagado]}
              >
                {guardando ? (
                  <ActivityIndicator color={colores.marcaTexto} />
                ) : (
                  <Text style={e.botonTexto}>Marcar resuelta</Text>
                )}
              </Pressable>

              <Pressable
                onPress={() => setModo("no_puedo")}
                accessibilityRole="button"
                style={e.enlace}
              >
                <Text style={e.enlaceTexto}>No puedo resolverla</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={e.etiqueta}>¿Por qué no pudiste resolverla?</Text>
              <TextInput
                value={motivo}
                onChangeText={setMotivo}
                placeholder="Cuenta qué lo impidió"
                placeholderTextColor={colores.textoSuave}
                multiline
                maxLength={500}
                accessibilityLabel="Motivo"
                style={e.input}
              />
              <Text style={e.nota}>
                Queda atendida con observación: no desaparece de la lista.
              </Text>

              {error ? <Text style={e.error}>{error}</Text> : null}

              <Pressable
                onPress={() => void noPuedo()}
                disabled={motivo.trim().length === 0 || guardando}
                accessibilityRole="button"
                accessibilityState={{
                  disabled: motivo.trim().length === 0 || guardando,
                }}
                style={[
                  e.boton,
                  (motivo.trim().length === 0 || guardando) && e.botonApagado,
                ]}
              >
                {guardando ? (
                  <ActivityIndicator color={colores.marcaTexto} />
                ) : (
                  <Text style={e.botonTexto}>Guardar la observación</Text>
                )}
              </Pressable>

              <Pressable
                onPress={() => setModo("resolver")}
                accessibilityRole="button"
                style={e.enlace}
              >
                <Text style={e.enlaceTexto}>Volver a resolverla</Text>
              </Pressable>
            </>
          )}

          <Pressable
            onPress={cerrar}
            accessibilityRole="button"
            style={e.enlace}
          >
            <Text style={e.enlaceTexto}>Cancelar</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const e = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.m, gap: espacio.s },
  titulo: { color: colores.texto, fontSize: 20, fontWeight: "800" },
  descripcion: { color: colores.textoSuave, fontSize: 14, lineHeight: 19 },
  etiqueta: {
    color: colores.texto,
    fontSize: 15,
    fontWeight: "700",
    marginTop: espacio.m,
  },
  sugerencias: { gap: espacio.xs },
  pastilla: {
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.superficie,
    paddingHorizontal: espacio.m,
    paddingVertical: espacio.s,
    minHeight: 44,
    justifyContent: "center",
  },
  pastillaTexto: { color: colores.texto, fontSize: 14 },
  input: {
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.superficie,
    color: colores.texto,
    padding: espacio.m,
    minHeight: 88,
    textAlignVertical: "top",
    fontSize: 15,
  },
  botonSecundario: {
    minHeight: 48,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.marca,
    alignItems: "center",
    justifyContent: "center",
    marginTop: espacio.xs,
  },
  botonSecundarioTexto: {
    color: colores.marca,
    fontSize: 15,
    fontWeight: "700",
  },
  boton: {
    minHeight: 48,
    borderRadius: radio.m,
    backgroundColor: colores.marca,
    alignItems: "center",
    justifyContent: "center",
    marginTop: espacio.s,
  },
  botonApagado: { opacity: 0.5 },
  botonTexto: { color: colores.marcaTexto, fontSize: 16, fontWeight: "700" },
  enlace: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  enlaceTexto: { color: colores.textoSuave, fontSize: 14, fontWeight: "600" },
  nota: { color: colores.textoSuave, fontSize: 13, lineHeight: 18 },
  error: { color: colores.alerta, fontSize: 14, lineHeight: 19 },
});
