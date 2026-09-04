import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import {
  agruparPorMarca,
  describirIncidencia,
  ETIQUETA_ESTADO,
  type IncidenciaLocal,
} from "@/lib/incidencias";
import { colores, espacio, radio } from "@/tema";

// La lista global de incidencias de la visita, agrupada por marca.
//
// "Independientemente del módulo donde surja la incidencia —góndola, exhibición,
// lo que sea—, esta debe acumularse en una lista global": el mercaderista no
// tiene por qué recordar en qué paso apareció cada cosa.
//
// Componente presentacional: no consulta la réplica ni navega. Así el estado que
// pinta —y sobre todo el vacío, que es delicado— se prueba sin PowerSync.

const COLOR_ESTADO: Record<string, string> = {
  pendiente: colores.alerta,
  resuelta: colores.completado,
  no_resuelta: colores.textoSuave,
};

export function ListaIncidencias({
  incidencias,
  cargando,
  error,
  conectado,
  onResolver,
  onVolver,
}: {
  incidencias: readonly IncidenciaLocal[];
  cargando: boolean;
  error: string | null;
  /** Si el teléfono alcanza al servidor. Decide qué puede afirmar el vacío. */
  conectado: boolean;
  onResolver: (incidencia: IncidenciaLocal) => void;
  onVolver: () => void;
}) {
  const grupos = agruparPorMarca(incidencias);

  return (
    <View style={e.pantalla}>
      <Pressable
        onPress={onVolver}
        hitSlop={8}
        accessibilityRole="button"
        style={e.volver}
      >
        <Text style={e.volverTexto}>‹ Volver</Text>
      </Pressable>
      <Text style={e.titulo}>Incidencias</Text>

      {error ? (
        <View style={e.centro}>
          <Text style={e.vacioTitulo}>No se pudo leer la lista</Text>
          <Text style={e.vacioNota}>
            Vuelve a entrar. Si sigue igual, avisa a tu supervisor.
          </Text>
        </View>
      ) : cargando ? (
        <View style={e.centro} accessibilityRole="progressbar">
          <Text style={e.vacioNota}>Cargando las incidencias…</Text>
        </View>
      ) : incidencias.length === 0 ? (
        <View style={e.centro}>
          {/* El vacío NO puede afirmar que no hay incidencias. Nacen de un
              cálculo del servidor, así que sin señal esta lista llega vacía
              aunque el mercaderista acabe de levantar un quiebre. Decir "no
              tienes incidencias" le haría saltarse trabajo real. */}
          {conectado ? (
            <>
              <Text style={e.vacioTitulo}>Nada que atender por ahora</Text>
              <Text style={e.vacioNota}>
                Las incidencias aparecen solas a partir de lo que levantas.
              </Text>
            </>
          ) : (
            <>
              <Text style={e.vacioTitulo}>Sin conexión</Text>
              <Text style={e.vacioNota}>
                Esta lista puede estar incompleta: las incidencias de lo que
                acabas de levantar aparecerán cuando sincronices.
              </Text>
            </>
          )}
        </View>
      ) : (
        <FlatList
          data={grupos}
          keyExtractor={(g) => g.marcaId ?? "sin-marca"}
          contentContainerStyle={{ paddingVertical: espacio.m, gap: espacio.m }}
          renderItem={({ item }) => (
            <View style={e.grupo}>
              <Text style={e.marca}>{item.marcaNombre}</Text>
              {item.incidencias.map((incidencia) => (
                <Pressable
                  key={incidencia.id}
                  onPress={() => onResolver(incidencia)}
                  disabled={incidencia.estado !== "pendiente"}
                  accessibilityRole="button"
                  accessibilityLabel={`${incidencia.sku_nombre ?? item.marcaNombre}, ${ETIQUETA_ESTADO[incidencia.estado]}`}
                  style={({ pressed }) => [e.card, pressed && { opacity: 0.7 }]}
                >
                  <View style={e.filaTitulo}>
                    <Text style={e.sku} numberOfLines={1}>
                      {incidencia.sku_nombre ?? item.marcaNombre}
                    </Text>
                    {/* El estado va como TEXTO: un punto de color no se lo dice
                        a nadie que no lo distinga (WCAG 1.4.1). */}
                    <Text
                      style={[
                        e.estado,
                        {
                          color:
                            COLOR_ESTADO[incidencia.estado] ??
                            colores.textoSuave,
                        },
                      ]}
                    >
                      {ETIQUETA_ESTADO[incidencia.estado]}
                    </Text>
                  </View>
                  <Text style={e.descripcion}>
                    {describirIncidencia(incidencia.origen, incidencia.detalle)}
                  </Text>
                  {incidencia.accion_tomada ? (
                    <Text style={e.accion}>
                      Acción: {incidencia.accion_tomada}
                    </Text>
                  ) : null}
                  {incidencia.motivo ? (
                    <Text style={e.accion}>Motivo: {incidencia.motivo}</Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          )}
        />
      )}
    </View>
  );
}

const e = StyleSheet.create({
  pantalla: { flex: 1 },
  volver: { paddingVertical: espacio.s },
  volverTexto: { color: colores.textoSuave, fontSize: 15, fontWeight: "600" },
  titulo: {
    color: colores.texto,
    fontSize: 22,
    fontWeight: "800",
    marginTop: espacio.xs,
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
  grupo: { gap: espacio.xs },
  marca: {
    color: colores.textoSuave,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  card: {
    backgroundColor: colores.superficie,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    padding: espacio.m,
    gap: 4,
  },
  filaTitulo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: espacio.s,
  },
  sku: { color: colores.texto, fontSize: 15, fontWeight: "600", flex: 1 },
  estado: { fontSize: 12, fontWeight: "700" },
  descripcion: { color: colores.textoSuave, fontSize: 14, lineHeight: 19 },
  accion: {
    color: colores.textoSuave,
    fontSize: 13,
    lineHeight: 18,
    fontStyle: "italic",
  },
});
