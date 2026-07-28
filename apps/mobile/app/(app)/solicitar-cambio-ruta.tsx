import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  etiquetaEstado,
  type SolicitudLocal,
  solicitudValida,
  TIPOS_SOLICITUD,
  type TipoSolicitud,
  useMiTenant,
  useMisSolicitudes,
} from "@/lib/solicitud-ruta";
import { crearSolicitud } from "@/lib/solicitud-ruta-crear";
import { useSesion } from "@/sesion";
import { colores, espacio, radio } from "@/tema";

// Solicitar cambio de ruta (MAR-77): el mercaderista pide un cambio con motivo.
// Offline-first: escribe en la réplica local y sube por la cola; el supervisor lo
// resuelve en el panel y el mercaderista ve el estado aquí mismo.

export default function SolicitarCambioRuta() {
  const router = useRouter();
  const sesion = useSesion();
  const userId = sesion?.user.id ?? "";
  const tenantId = useMiTenant(userId);
  const solicitudes = useMisSolicitudes();

  const [tipo, setTipo] = useState<TipoSolicitud | null>(null);
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);

  const valido = tipo != null && solicitudValida(tipo, motivo);

  async function enviar() {
    if (!valido || !tipo || !tenantId || !userId || guardando) return;
    setGuardando(true);
    try {
      await crearSolicitud({
        tenant_id: tenantId,
        mercaderista_id: userId,
        tipo,
        motivo,
      });
      setTipo(null);
      setMotivo("");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <ScrollView
      style={e.pantalla}
      contentContainerStyle={{ padding: espacio.m, paddingBottom: espacio.xl }}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable onPress={() => router.back()} hitSlop={8} style={e.volver}>
        <Text style={e.volverTexto}>‹ Mi día</Text>
      </Pressable>
      <Text style={e.titulo}>Solicitar cambio de ruta</Text>
      <Text style={e.subtitulo}>
        Tu supervisor lo revisa y ajusta la planeación.
      </Text>

      <Seccion titulo="¿Qué necesitas cambiar?">
        <View style={e.tipos}>
          {TIPOS_SOLICITUD.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => setTipo(t.id)}
              style={[e.tipo, tipo === t.id && e.tipoActivo]}
              accessibilityRole="button"
              accessibilityState={{ selected: tipo === t.id }}
            >
              <Text style={[e.tipoTexto, tipo === t.id && e.tipoTextoActivo]}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Seccion>

      <Seccion titulo="Motivo (obligatorio)">
        <TextInput
          value={motivo}
          onChangeText={setMotivo}
          placeholder="Cuéntale a tu supervisor por qué…"
          placeholderTextColor={colores.textoSuave}
          style={e.input}
          multiline
          accessibilityLabel="Motivo del cambio de ruta"
        />
      </Seccion>

      <Pressable
        onPress={() => void enviar()}
        disabled={!valido || guardando}
        style={[e.boton, (!valido || guardando) && e.botonInactivo]}
        accessibilityRole="button"
      >
        {guardando ? (
          <ActivityIndicator color={colores.marcaTexto} />
        ) : (
          <Text style={e.botonTexto}>Enviar solicitud</Text>
        )}
      </Pressable>

      {solicitudes.length > 0 ? (
        <Seccion titulo="Mis solicitudes">
          {solicitudes.map((s) => (
            <SolicitudItem key={s.id} solicitud={s} />
          ))}
        </Seccion>
      ) : null}
    </ScrollView>
  );
}

function SolicitudItem({ solicitud }: { solicitud: SolicitudLocal }) {
  const tipo = TIPOS_SOLICITUD.find((t) => t.id === solicitud.tipo);
  return (
    <View style={e.item}>
      <View style={e.itemFila}>
        <Text style={e.itemTipo} numberOfLines={1}>
          {tipo?.label ?? solicitud.tipo}
        </Text>
        <Text style={[e.chip, chipColor(solicitud.estado)]}>
          {etiquetaEstado(solicitud.estado)}
        </Text>
      </View>
      <Text style={e.itemMotivo}>{solicitud.motivo}</Text>
      {solicitud.comentario_resolucion ? (
        <Text style={e.itemComentario}>
          Supervisor: {solicitud.comentario_resolucion}
        </Text>
      ) : null}
    </View>
  );
}

function chipColor(estado: string) {
  if (estado === "resuelta") return { color: colores.completado };
  if (estado === "rechazada") return { color: colores.alerta };
  if (estado === "vista") return { color: colores.marca };
  return { color: colores.textoSuave };
}

function Seccion({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <View style={e.seccion}>
      <Text style={e.seccionTitulo}>{titulo}</Text>
      {children}
    </View>
  );
}

const e = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  volver: { paddingVertical: espacio.s },
  volverTexto: { color: colores.textoSuave, fontSize: 15, fontWeight: "600" },
  titulo: {
    color: colores.texto,
    fontSize: 24,
    fontWeight: "800",
    marginTop: espacio.s,
  },
  subtitulo: { color: colores.textoSuave, fontSize: 14, marginTop: 2 },
  seccion: {
    backgroundColor: colores.superficie,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    padding: espacio.m,
    marginTop: espacio.m,
    gap: espacio.s,
  },
  seccionTitulo: {
    color: colores.textoSuave,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tipos: { gap: espacio.xs },
  tipo: {
    borderWidth: 1,
    borderColor: colores.borde,
    borderRadius: radio.s,
    paddingHorizontal: espacio.m,
    paddingVertical: espacio.s,
    backgroundColor: colores.fondo,
  },
  tipoActivo: { borderColor: colores.marca, backgroundColor: colores.marca },
  tipoTexto: { color: colores.texto, fontSize: 14, fontWeight: "600" },
  tipoTextoActivo: { color: colores.marcaTexto },
  input: {
    backgroundColor: colores.fondo,
    borderRadius: radio.s,
    borderWidth: 1,
    borderColor: colores.borde,
    color: colores.texto,
    fontSize: 15,
    padding: espacio.m,
    minHeight: 88,
    textAlignVertical: "top",
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
  item: {
    borderTopWidth: 1,
    borderTopColor: colores.borde,
    paddingTop: espacio.s,
    gap: 3,
  },
  itemFila: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: espacio.s,
  },
  itemTipo: { color: colores.texto, fontSize: 14, fontWeight: "600", flex: 1 },
  chip: { fontSize: 12, fontWeight: "700" },
  itemMotivo: { color: colores.textoSuave, fontSize: 13, lineHeight: 18 },
  itemComentario: {
    color: colores.texto,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
});
