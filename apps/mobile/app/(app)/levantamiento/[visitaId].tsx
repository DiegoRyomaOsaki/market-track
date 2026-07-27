import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { type MarcaAuditable, useMarcasDeVisita } from "@/lib/levantamiento";
import { colores, espacio, radio } from "@/tema";

// El selector de marcas de una visita: una visita = un levantamiento por marca
// (cada marca vive en su pasillo). En el piloto hay UNA sola marca, así que esta
// pantalla se salta y se entra directo al wizard. El shell del wizard, los pasos
// y la contingencia viven en [visitaId]/[marcaId].

type EstadoMarca = "pendiente" | "en_curso" | "completado";

function estadoMarca(estado: string | null): EstadoMarca {
  if (estado === "completado" || estado === "omitido") return "completado";
  if (estado === "en_curso") return "en_curso";
  return "pendiente";
}

export default function SelectorMarcas() {
  const router = useRouter();
  const { visitaId } = useLocalSearchParams<{ visitaId: string }>();
  const { marcas, cargando } = useMarcasDeVisita(visitaId);
  const yaSalto = useRef(false);

  // Piloto: una sola marca pendiente → se entra directo, sin mostrar el selector.
  const unica = marcas.length === 1 ? marcas[0] : null;
  useEffect(() => {
    if (cargando || yaSalto.current || !unica) return;
    if (estadoMarca(unica.levantamiento_estado) !== "completado") {
      yaSalto.current = true;
      router.replace(`/levantamiento/${visitaId}/${unica.id}`);
    }
  }, [cargando, unica, router, visitaId]);

  const todasListas =
    marcas.length > 0 &&
    marcas.every((m) => estadoMarca(m.levantamiento_estado) === "completado");

  return (
    <View style={e.pantalla}>
      <Pressable onPress={() => router.back()} hitSlop={8} style={e.volver}>
        <Text style={e.volverTexto}>‹ Mi día</Text>
      </Pressable>
      <Text style={e.titulo}>Levantamiento</Text>
      <Text style={e.subtitulo}>Una auditoría por marca en esta tienda.</Text>

      {todasListas ? (
        <View style={e.tarjeta}>
          <Text style={[e.estado, { color: colores.completado }]}>
            ✓ Todas las marcas listas
          </Text>
          <Text style={e.nota}>Puedes continuar con el check-out.</Text>
        </View>
      ) : null}

      {cargando ? (
        <View style={e.centro}>
          <ActivityIndicator color={colores.marca} />
        </View>
      ) : marcas.length === 0 ? (
        <View style={e.centro}>
          <Text style={e.vacioTitulo}>Sin marcas por auditar</Text>
          <Text style={e.vacioNota}>
            Esta tienda no tiene SKU codificados de tu cliente.
          </Text>
        </View>
      ) : (
        <FlatList
          data={marcas}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingVertical: espacio.m, gap: espacio.s }}
          renderItem={({ item }) => (
            <MarcaItem
              marca={item}
              onPress={() =>
                router.push(`/levantamiento/${visitaId}/${item.id}`)
              }
            />
          )}
        />
      )}
    </View>
  );
}

function MarcaItem({
  marca,
  onPress,
}: {
  marca: MarcaAuditable;
  onPress: () => void;
}) {
  const estado = estadoMarca(marca.levantamiento_estado);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${marca.nombre}, ${ETIQUETA[estado]}`}
      style={({ pressed }) => [e.card, pressed && { opacity: 0.7 }]}
    >
      <Text style={e.marca} numberOfLines={1}>
        {marca.nombre}
      </Text>
      <View style={e.chip}>
        <View style={[e.punto, { backgroundColor: COLOR[estado] }]} />
        <Text style={[e.chipTexto, { color: COLOR[estado] }]}>
          {ETIQUETA[estado]}
        </Text>
      </View>
    </Pressable>
  );
}

const ETIQUETA: Record<EstadoMarca, string> = {
  pendiente: "Pendiente",
  en_curso: "En curso",
  completado: "Completado",
};

const COLOR: Record<EstadoMarca, string> = {
  pendiente: colores.textoSuave,
  en_curso: colores.marca,
  completado: colores.completado,
};

const e = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo, padding: espacio.m },
  volver: { paddingVertical: espacio.s },
  volverTexto: { color: colores.textoSuave, fontSize: 15, fontWeight: "600" },
  titulo: {
    color: colores.texto,
    fontSize: 24,
    fontWeight: "800",
    marginTop: espacio.s,
  },
  subtitulo: { color: colores.textoSuave, fontSize: 14, marginTop: 2 },
  tarjeta: {
    backgroundColor: colores.superficie,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    padding: espacio.l,
    marginTop: espacio.l,
    gap: espacio.s,
  },
  estado: { fontSize: 18, fontWeight: "700" },
  nota: { color: colores.textoSuave, fontSize: 14, lineHeight: 20 },
  centro: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: espacio.xl,
    gap: espacio.s,
  },
  vacioTitulo: { color: colores.texto, fontSize: 17, fontWeight: "700" },
  vacioNota: {
    color: colores.textoSuave,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: espacio.m,
    backgroundColor: colores.superficie,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    padding: espacio.m,
  },
  marca: { color: colores.texto, fontSize: 16, fontWeight: "600", flex: 1 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6 },
  punto: { width: 8, height: 8, borderRadius: 4 },
  chipTexto: { fontSize: 12, fontWeight: "700" },
});
