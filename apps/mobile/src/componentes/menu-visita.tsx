import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import type { MarcaAuditable } from "@/lib/levantamiento";
import type { PasoWizard } from "@/lib/pasos-levantamiento";
import type { EstadoModulo, ProgresoModulo } from "@/lib/progreso-visita";
import { colores, espacio, radio } from "@/tema";

// El menú de la visita: los módulos, y dentro de cada uno el estado de cada
// marca.
//
// Es la pantalla que hace posible el acuerdo de la 4ª revisión — "módulo
// primero, marca después"— y su motivo operativo: el mercaderista no puede
// quedarse trabado. Si no lo dejan entrar a la trastienda, entra a otro módulo y
// vuelve después.
//
// Componente presentacional a propósito: no consulta la réplica ni navega, todo
// entra por props. Así el estado que pinta se prueba sin montar el árbol de
// navegación ni PowerSync.

export type ModuloDeMarca = {
  marca: MarcaAuditable;
  progreso: ProgresoModulo;
};

export type ModuloDelMenu = {
  modulo: PasoWizard;
  /** Una entrada por marca en la que este módulo existe. */
  marcas: ModuloDeMarca[];
};

const ETIQUETA: Record<EstadoModulo, string> = {
  pendiente: "Pendiente",
  completado: "Listo",
  omitido: "Omitido",
};

const COLOR: Record<EstadoModulo, string> = {
  pendiente: colores.textoSuave,
  completado: colores.completado,
  omitido: colores.alerta,
};

export function MenuVisita({
  modulos,
  cargando,
  todoListo,
  onAbrir,
  onCheckOut,
}: {
  modulos: readonly ModuloDelMenu[];
  cargando: boolean;
  todoListo: boolean;
  onAbrir: (idModulo: string, marcaId: string) => void;
  onCheckOut: () => void;
}) {
  if (cargando) {
    return (
      <View style={e.centro} accessibilityRole="progressbar">
        <Text style={e.vacioNota}>Cargando los módulos de la visita…</Text>
      </View>
    );
  }

  if (modulos.length === 0) {
    return (
      <View style={e.centro}>
        <Text style={e.vacioTitulo}>Sin marcas por auditar</Text>
        <Text style={e.vacioNota}>
          Esta tienda no tiene SKU codificados de tu cliente.
        </Text>
      </View>
    );
  }

  return (
    <>
      {todoListo ? (
        <View style={e.tarjeta}>
          <Text style={[e.estado, { color: colores.completado }]}>
            ✓ Todos los módulos listos
          </Text>
          <Text style={e.nota}>Puedes continuar con el check-out.</Text>
          <Pressable
            onPress={onCheckOut}
            style={e.boton}
            accessibilityRole="button"
          >
            <Text style={e.botonTexto}>Ir al check-out</Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        data={modulos}
        keyExtractor={(m) => m.modulo.id}
        contentContainerStyle={{ paddingVertical: espacio.m, gap: espacio.s }}
        renderItem={({ item }) => (
          <View style={e.card}>
            <Text style={e.moduloTitulo}>{item.modulo.titulo}</Text>
            {item.marcas.map(({ marca, progreso }) => (
              <Pressable
                key={marca.id}
                onPress={() => onAbrir(item.modulo.id, marca.id)}
                accessibilityRole="button"
                accessibilityLabel={`${item.modulo.titulo}, ${marca.nombre}, ${ETIQUETA[progreso.estado]}`}
                style={({ pressed }) => [e.fila, pressed && { opacity: 0.7 }]}
              >
                <Text style={e.marca} numberOfLines={1}>
                  {marca.nombre}
                </Text>
                <View style={e.chip}>
                  <View
                    style={[
                      e.punto,
                      { backgroundColor: COLOR[progreso.estado] },
                    ]}
                  />
                  {/* El estado viaja como TEXTO, no solo por color: un punto de
                      color no se lo dice a nadie que no lo vea (WCAG 1.4.1). */}
                  <Text
                    style={[e.chipTexto, { color: COLOR[progreso.estado] }]}
                  >
                    {ETIQUETA[progreso.estado]}
                  </Text>
                </View>
              </Pressable>
            ))}
            {/* El motivo del bypass sobrevive aunque el módulo se complete
                después: es lo que el mercaderista necesita recordar de por qué
                tuvo que volver. */}
            {item.marcas
              .filter((m) => m.progreso.motivoOmision)
              .map((m) => (
                <Text key={`motivo-${m.marca.id}`} style={e.motivo}>
                  {m.marca.nombre}: {m.progreso.motivoOmision}
                </Text>
              ))}
          </View>
        )}
      />
    </>
  );
}

const e = StyleSheet.create({
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
  boton: {
    height: 48,
    borderRadius: radio.m,
    backgroundColor: colores.marca,
    alignItems: "center",
    justifyContent: "center",
    marginTop: espacio.xs,
  },
  botonTexto: { color: colores.marcaTexto, fontSize: 16, fontWeight: "700" },
  card: {
    backgroundColor: colores.superficie,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    padding: espacio.m,
    gap: espacio.xs,
  },
  moduloTitulo: {
    color: colores.texto,
    fontSize: 16,
    fontWeight: "700",
    marginBottom: espacio.xs,
  },
  fila: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: espacio.m,
    paddingVertical: espacio.xs,
  },
  marca: { color: colores.texto, fontSize: 15, flex: 1 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6 },
  punto: { width: 8, height: 8, borderRadius: 4 },
  chipTexto: { fontSize: 12, fontWeight: "700" },
  motivo: {
    color: colores.textoSuave,
    fontSize: 12,
    lineHeight: 17,
    fontStyle: "italic",
  },
});
