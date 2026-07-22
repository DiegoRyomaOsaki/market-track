import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { supabase } from "@/lib/supabase";
import { olvidarDispositivo } from "@/lib/recordar-dispositivo";
import {
  type EstadoVisual,
  estadoVisual,
  type ParadaDeHoy,
  useRuteroDeHoy,
} from "@/lib/rutero";
import { colores, espacio, radio } from "@/tema";

async function cerrarSesion() {
  await olvidarDispositivo();
  await supabase.auth.signOut();
}

function fechaLarga(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const fecha = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
  return fecha.toLocaleDateString("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/**
 * "Mi día": el rutero del mercaderista, leído de la réplica local. Cada tienda
 * abre su check-in. El estado por tienda se deriva de la visita (ver rutero.ts).
 */
export default function MiDia() {
  const router = useRouter();
  const { paradas, cargando, fecha } = useRuteroDeHoy();

  const completadas = paradas.filter(
    (p) => estadoVisual(p.visita_estado) === "completada",
  ).length;

  return (
    <View style={e.pantalla}>
      <View style={e.encabezado}>
        <View style={{ flex: 1 }}>
          <Text style={e.titulo}>Mi día</Text>
          <Text style={e.fecha}>{fechaLarga(fecha)}</Text>
        </View>
        <Pressable
          onPress={() => void cerrarSesion()}
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => pressed && { opacity: 0.6 }}
        >
          <Text style={e.salir}>Salir</Text>
        </Pressable>
      </View>

      {paradas.length > 0 && (
        <Text style={e.progreso}>
          {completadas} de {paradas.length} visitas completadas
        </Text>
      )}

      {cargando ? (
        <View style={e.centro}>
          <ActivityIndicator color={colores.marca} />
        </View>
      ) : paradas.length === 0 ? (
        <View style={e.centro}>
          <Text style={e.vacioTitulo}>No tienes rutero para hoy</Text>
          <Text style={e.vacioNota}>
            Cuando tu supervisor publique tu ruta, tus tiendas aparecerán aquí.
          </Text>
        </View>
      ) : (
        <FlatList
          data={paradas}
          keyExtractor={(p) => p.parada_id}
          contentContainerStyle={{ padding: espacio.m, gap: espacio.s }}
          renderItem={({ item }) => (
            <ParadaItem
              parada={item}
              onPress={() => router.push(`/check-in/${item.parada_id}`)}
            />
          )}
        />
      )}
    </View>
  );
}

function ParadaItem({
  parada,
  onPress,
}: {
  parada: ParadaDeHoy;
  onPress: () => void;
}) {
  const estado = estadoVisual(parada.visita_estado);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${parada.tienda_nombre}, ${ETIQUETA[estado]}`}
      style={({ pressed }) => [e.card, pressed && { opacity: 0.7 }]}
    >
      <View style={e.orden}>
        <Text style={e.ordenTexto}>{parada.orden}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={e.tienda} numberOfLines={1}>
          {parada.tienda_nombre}
        </Text>
        {parada.tienda_direccion ? (
          <Text style={e.direccion} numberOfLines={1}>
            {parada.tienda_direccion}
          </Text>
        ) : null}
      </View>
      <Semaforo estado={estado} />
    </Pressable>
  );
}

const ETIQUETA: Record<EstadoVisual, string> = {
  pendiente: "Pendiente",
  en_curso: "En curso",
  completada: "Completada",
};

const COLOR: Record<EstadoVisual, string> = {
  pendiente: colores.textoSuave,
  en_curso: colores.marca,
  completada: colores.completado,
};

function Semaforo({ estado }: { estado: EstadoVisual }) {
  return (
    <View style={e.chip}>
      <View style={[e.punto, { backgroundColor: COLOR[estado] }]} />
      <Text style={[e.chipTexto, { color: COLOR[estado] }]}>
        {ETIQUETA[estado]}
      </Text>
    </View>
  );
}

const e = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  encabezado: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: espacio.m,
    paddingTop: espacio.m,
    gap: espacio.m,
  },
  titulo: { color: colores.texto, fontSize: 26, fontWeight: "800" },
  fecha: {
    color: colores.textoSuave,
    fontSize: 14,
    marginTop: 2,
    textTransform: "capitalize",
  },
  salir: { color: colores.textoSuave, fontSize: 14, fontWeight: "600" },
  progreso: {
    color: colores.textoSuave,
    fontSize: 13,
    paddingHorizontal: espacio.m,
    marginTop: espacio.s,
  },
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
    gap: espacio.m,
    backgroundColor: colores.superficie,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    padding: espacio.m,
  },
  orden: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colores.fondo,
    borderWidth: 1,
    borderColor: colores.borde,
    alignItems: "center",
    justifyContent: "center",
  },
  ordenTexto: { color: colores.textoSuave, fontSize: 14, fontWeight: "700" },
  tienda: { color: colores.texto, fontSize: 16, fontWeight: "600" },
  direccion: { color: colores.textoSuave, fontSize: 13, marginTop: 2 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6 },
  punto: { width: 8, height: 8, borderRadius: 4 },
  chipTexto: { fontSize: 12, fontWeight: "700" },
});
