import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useCountFotos } from "@/lib/cola-fotos-instancia";
import { useEstadoSync } from "@/lib/powersync/estado";
import { colores, espacio, radio } from "@/tema";

// El indicador de estado, siempre visible (ADR-0001). Muestra online/offline y
// las DOS colas por separado: registros (motor de sync) y fotos (cola a R2).
// Que estén separadas es lo que deja ver que una visita ya subió mientras sus
// fotos siguen esperando señal.

export function IndicadorConexion() {
  const router = useRouter();
  const { conectado, subiendo, bajando, pendientesRegistros } = useEstadoSync();
  const pendientesFotos = useCountFotos();

  const trabajando = subiendo || bajando;
  const colorPunto = conectado
    ? trabajando
      ? colores.marca
      : colores.completado
    : colores.textoSuave;

  return (
    <Pressable
      onPress={() => router.push("/sincronizacion")}
      style={e.barra}
      accessibilityRole="button"
      accessibilityLabel="Ver estado de sincronización"
    >
      <View style={e.estado}>
        <View style={[e.punto, { backgroundColor: colorPunto }]} />
        <Text style={e.textoEstado}>
          {conectado
            ? trabajando
              ? "Sincronizando…"
              : "En línea"
            : "Sin conexión"}
        </Text>
      </View>

      <View style={e.colas}>
        <Contador
          etiqueta="Registros"
          n={pendientesRegistros}
          accesible="registros pendientes de subir"
        />
        <Contador
          etiqueta="Fotos"
          n={pendientesFotos}
          accesible="fotos pendientes de subir"
        />
      </View>
    </Pressable>
  );
}

function Contador({
  etiqueta,
  n,
  accesible,
}: {
  etiqueta: string;
  n: number;
  accesible: string;
}) {
  const pendiente = n > 0;
  return (
    <View style={e.contador} accessibilityLabel={`${n} ${accesible}`}>
      <Text style={e.contadorEtiqueta}>{etiqueta}</Text>
      <View style={[e.chip, pendiente ? e.chipPendiente : e.chipVacio]}>
        <Text
          style={[
            e.chipTexto,
            { color: pendiente ? colores.marcaTexto : colores.textoSuave },
          ]}
        >
          {n}
        </Text>
      </View>
    </View>
  );
}

const e = StyleSheet.create({
  barra: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: espacio.m,
    paddingVertical: espacio.s,
    backgroundColor: colores.superficie,
    borderBottomWidth: 1,
    borderBottomColor: colores.borde,
  },
  estado: { flexDirection: "row", alignItems: "center", gap: espacio.s },
  punto: { width: 10, height: 10, borderRadius: 5 },
  textoEstado: { color: colores.texto, fontSize: 13, fontWeight: "600" },
  colas: { flexDirection: "row", gap: espacio.m },
  contador: { flexDirection: "row", alignItems: "center", gap: espacio.xs },
  contadorEtiqueta: { color: colores.textoSuave, fontSize: 12 },
  chip: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radio.s,
    alignItems: "center",
  },
  chipPendiente: { backgroundColor: colores.marca },
  chipVacio: { backgroundColor: colores.borde },
  chipTexto: { fontSize: 12, fontWeight: "700" },
});
