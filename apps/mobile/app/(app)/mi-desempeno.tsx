import { useRouter } from "expo-router";
import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { diaEnLima, etiquetaDePeriodo } from "@market-track/shared";

import { TarjetaDesempeno } from "@/componentes/tarjeta-desempeno";
import {
  desglosePorVariable,
  formatearPct,
  textoFrescura,
  useMiDesempeno,
} from "@/lib/desempeno";
import { useEstadoSync } from "@/lib/powersync/estado";
import { colores, espacio, radio } from "@/tema";

/**
 * "Mi desempeño": el puntaje del plan de lealtad, su posición y de dónde sale.
 *
 * Todo de la réplica local — cero red, como cualquier pantalla que el
 * mercaderista pueda abrir en un sótano sin señal. Y solo lo SUYO: el ranking
 * completo no baja al teléfono (decisión del cliente, y la cumplen las sync
 * rules, no la RLS).
 *
 * Sin lógica propia: lo que se pinta lo resuelven las funciones puras de
 * `lib/desempeno.ts`, que es donde se prueban — este workspace no tiene tests de
 * componente, así que lo que viva aquí queda sin cubrir por construcción.
 */
function Volver({ onPress }: { onPress: () => void }) {
  // La misma affordance que las otras seis pantallas de `(app)`: el stack va
  // con `headerShown: false`, así que sin esto solo queda el gesto del sistema —
  // y este se usa de pie, con una mano, a veces con guantes.
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      style={e.volver}
    >
      <Text style={e.volverTexto}>‹ Mi día</Text>
    </Pressable>
  );
}

export default function MiDesempeno() {
  const router = useRouter();
  const hoy = useMemo(() => diaEnLima(new Date()), []);
  const { tipo, actual, evolucion, cargando, error } = useMiDesempeno(hoy);
  const { conectado, ultimaSync } = useEstadoSync();

  if (cargando) {
    return (
      <View style={[e.pantalla, e.centroConVolver]}>
        <Volver onPress={() => router.back()} />
        <ActivityIndicator color={colores.marca} />
      </View>
    );
  }

  // El error NO se traga: una réplica desfasada tras una actualización deja la
  // consulta rota, y una pantalla vacía se lee como "aún no tienes puntaje".
  if (error) {
    return (
      <View style={[e.pantalla, e.centroConVolver]}>
        <Volver onPress={() => router.back()} />
        <Text style={e.vacioTitulo}>No se pudo leer tu puntaje</Text>
        <Text style={e.vacioNota}>
          Vuelve a abrir la app. Si sigue igual, avísale a tu supervisor.
        </Text>
      </View>
    );
  }

  if (actual === null) {
    return (
      <View style={[e.pantalla, e.centroConVolver]}>
        <Volver onPress={() => router.back()} />
        <Text style={e.vacioTitulo}>Todavía no tienes puntaje</Text>
        <Text style={e.vacioNota}>
          Aparecerá aquí en cuanto se calcule tu primer periodo.
        </Text>
      </View>
    );
  }

  const variables = desglosePorVariable(actual);

  return (
    <ScrollView style={e.pantalla} contentContainerStyle={e.contenido}>
      <Volver onPress={() => router.back()} />
      <Text style={e.titulo}>Mi desempeño</Text>

      <TarjetaDesempeno
        etiquetaPeriodo={etiquetaDePeriodo(tipo, actual.periodo_inicio)}
        totalPct={actual.total_pct}
        posicion={actual.posicion}
        evaluados={actual.mercaderistas_evaluados}
        hayEmpate={actual.hay_empate === 1}
        cerrado={actual.cerrado_at !== null}
      />

      {/* De cuándo es lo que estás mirando. Sin señal dice ADEMÁS cuándo habló
          por última vez el teléfono con el servidor: el puntaje puede ser exacto
          y aun así haber uno más nuevo esperando a que haya cobertura. */}
      <Text style={e.frescura}>
        {textoFrescura(actual.calculado_at, ultimaSync, conectado)}
      </Text>

      <Text style={e.seccion}>De dónde sale tu puntaje</Text>
      {variables.map((v) => (
        <View key={v.clave} style={e.variable}>
          <View style={{ flex: 1 }}>
            <Text style={e.variableEtiqueta}>{v.etiqueta}</Text>
            <Text style={e.variableDetalle}>{v.detalle}</Text>
          </View>
          <Text style={e.variablePct}>{formatearPct(v.pct)}</Text>
        </View>
      ))}

      {evolucion.length > 1 ? (
        <>
          <Text style={e.seccion}>Cómo has evolucionado</Text>
          {evolucion.map((p) => (
            <View key={p.periodo_inicio} style={e.evolucion}>
              <Text style={e.evolucionPeriodo}>{p.etiqueta}</Text>
              <Text style={e.evolucionTotal}>{formatearPct(p.total_pct)}</Text>
              {/* El triángulo es forma y color: el lector de pantalla recibe
                  la dirección en palabras (WCAG 1.4.1). */}
              <Text
                style={e.evolucionDelta}
                accessibilityLabel={p.deltaDescripcion}
              >
                {p.delta}
              </Text>
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const e = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.m, gap: espacio.s },
  // Los estados que no son "éxito" también llevan el control de vuelta, así que
  // no pueden centrar su contenido en el eje transversal: el "‹ Mi día" quedaría
  // en medio de la pantalla en vez de arriba a la izquierda.
  centroConVolver: { padding: espacio.m, justifyContent: "center" },
  volver: { paddingVertical: espacio.s },
  volverTexto: { color: colores.textoSuave, fontSize: 15, fontWeight: "600" },
  titulo: {
    color: colores.texto,
    fontSize: 24,
    fontWeight: "700",
    marginBottom: espacio.xs,
  },
  frescura: { color: colores.textoSuave, fontSize: 12 },
  seccion: {
    color: colores.texto,
    fontSize: 15,
    fontWeight: "600",
    marginTop: espacio.m,
  },
  variable: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colores.superficie,
    borderColor: colores.borde,
    borderWidth: 1,
    borderRadius: radio.m,
    padding: espacio.m,
    gap: espacio.s,
  },
  variableEtiqueta: { color: colores.texto, fontSize: 15 },
  variableDetalle: { color: colores.textoSuave, fontSize: 12 },
  variablePct: { color: colores.texto, fontSize: 18, fontWeight: "600" },
  evolucion: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: espacio.s,
    borderBottomColor: colores.borde,
    borderBottomWidth: 1,
    gap: espacio.s,
  },
  evolucionPeriodo: { color: colores.texto, fontSize: 14, flex: 1 },
  evolucionTotal: { color: colores.texto, fontSize: 14, fontWeight: "600" },
  evolucionDelta: { color: colores.textoSuave, fontSize: 13, minWidth: 44 },
  vacioTitulo: { color: colores.texto, fontSize: 17, fontWeight: "600" },
  vacioNota: {
    color: colores.textoSuave,
    fontSize: 14,
    textAlign: "center",
    marginTop: espacio.xs,
  },
});
