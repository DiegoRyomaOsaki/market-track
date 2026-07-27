import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useFotosPendientes } from "@/lib/cola-fotos-instancia";
import { useEstadoSync } from "@/lib/powersync/estado";
import { colores, espacio, radio } from "@/tema";

// Pantalla de sincronización: las DOS colas por separado (registros por el motor
// de sync, fotos por la cola de disco a R2). El registro puede estar arriba con
// las fotos aún esperando señal. La subida real de fotos a R2 sube en segundo
// plano cuando hay conexión.

function hora(iso: string): string {
  const d = new Date(iso);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

export default function Sincronizacion() {
  const router = useRouter();
  const { conectado, subiendo, bajando, pendientesRegistros } = useEstadoSync();
  const fotos = useFotosPendientes();

  const trabajando = subiendo || bajando;

  return (
    <ScrollView
      style={e.pantalla}
      contentContainerStyle={{ padding: espacio.m, paddingBottom: espacio.xl }}
    >
      <Pressable onPress={() => router.back()} hitSlop={8} style={e.volver}>
        <Text style={e.volverTexto}>‹ Volver</Text>
      </Pressable>
      <Text style={e.titulo}>Sincronización</Text>

      <View style={e.estadoBar}>
        <View
          style={[
            e.punto,
            {
              backgroundColor: conectado
                ? trabajando
                  ? colores.marca
                  : colores.completado
                : colores.textoSuave,
            },
          ]}
        />
        <Text style={e.estadoTexto}>
          {conectado
            ? trabajando
              ? "Sincronizando…"
              : "En línea"
            : "Sin conexión"}
        </Text>
      </View>

      <Seccion titulo="Registros">
        <View style={e.fila}>
          <Text style={e.filaTexto}>Pendientes de subir</Text>
          <Text style={e.numero}>{pendientesRegistros}</Text>
        </View>
        <Text style={e.nota}>
          {pendientesRegistros === 0
            ? "Todo el trabajo de campo está sincronizado."
            : "Se subirán en cuanto haya señal; no hace falta esperar aquí."}
        </Text>
      </Seccion>

      <Seccion titulo="Fotos">
        <View style={e.fila}>
          <Text style={e.filaTexto}>Pendientes de subir</Text>
          <Text style={e.numero}>{fotos.length}</Text>
        </View>
        {fotos.length === 0 ? (
          <Text style={e.nota}>No hay fotos en cola.</Text>
        ) : (
          <>
            {fotos.map((f) => (
              <View key={f.id} style={e.foto}>
                <Text style={e.fotoHash}>{f.hash.slice(0, 8)}</Text>
                <Text style={e.fotoHora}>capturada {hora(f.encolada_at)}</Text>
              </View>
            ))}
            <Text style={e.nota}>
              Las fotos suben por su propia cola cuando hay conexión; el
              check-out no las espera.
            </Text>
          </>
        )}
      </Seccion>
    </ScrollView>
  );
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
  estadoBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: espacio.s,
    marginTop: espacio.m,
  },
  punto: { width: 10, height: 10, borderRadius: 5 },
  estadoTexto: { color: colores.texto, fontSize: 15, fontWeight: "600" },
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
  fila: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  filaTexto: { color: colores.texto, fontSize: 15 },
  numero: { color: colores.texto, fontSize: 22, fontWeight: "800" },
  nota: { color: colores.textoSuave, fontSize: 13, lineHeight: 18 },
  foto: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: colores.borde,
    paddingTop: espacio.s,
  },
  fotoHash: {
    color: colores.texto,
    fontSize: 13,
    fontFamily: "monospace",
  },
  fotoHora: { color: colores.textoSuave, fontSize: 12 },
});
