import { StyleSheet, Text, View } from "react-native";

import { formatearPct, textoDeMiPosicion } from "@/lib/desempeno";
import { colores, espacio, radio } from "@/tema";

// El puntaje propio, en una tarjeta. Dos consumidores reales —la portada de
// "Mi día" y la pantalla de detalle—, que es lo que justifica extraerla en vez
// de duplicar el marcado.
//
// No decide nada: recibe números ya resueltos por el servidor y los pinta. La
// posición no se calcula aquí ni podría — el teléfono solo tiene su propia fila.

export function TarjetaDesempeno({
  etiquetaPeriodo,
  totalPct,
  posicion,
  evaluados,
  hayEmpate,
  cerrado,
  compacta = false,
}: {
  etiquetaPeriodo: string;
  totalPct: number | null;
  posicion: number | null;
  evaluados: number | null;
  hayEmpate: boolean;
  cerrado: boolean;
  /** En la portada la tarjeta es un resumen; en su pantalla, la cabecera. */
  compacta?: boolean;
}) {
  const puesto = textoDeMiPosicion(posicion, evaluados, hayEmpate);
  const estado = cerrado ? "Cerrado" : "En curso";

  return (
    <View
      style={[e.tarjeta, compacta && e.compacta]}
      accessibilityRole="summary"
      // Con lector de pantalla, los tres números sueltos se leen sin relación.
      // Aquí se dicen como una frase, incluido el "de N" y el estado del periodo.
      accessibilityLabel={`Mi puntaje de ${etiquetaPeriodo}: ${formatearPct(totalPct)} sobre 100. Posición: ${puesto}. Periodo ${estado.toLowerCase()}.`}
    >
      <View style={e.fila}>
        <Text style={e.periodo}>{etiquetaPeriodo}</Text>
        {/* El estado en texto, no por color: un chip de color solo no dice
            nada a quien no lo distingue (WCAG 1.4.1). */}
        <Text style={[e.estado, cerrado && e.estadoCerrado]}>{estado}</Text>
      </View>

      <View style={e.numeros}>
        <View>
          <Text style={[e.total, compacta && e.totalCompacto]}>
            {formatearPct(totalPct)}
          </Text>
          <Text style={e.totalNota}>de 100</Text>
        </View>
        <View style={e.posicionCaja}>
          <Text style={e.posicion}>{puesto}</Text>
          <Text style={e.posicionNota}>tu posición</Text>
        </View>
      </View>
    </View>
  );
}

const e = StyleSheet.create({
  tarjeta: {
    backgroundColor: colores.superficie,
    borderColor: colores.borde,
    borderWidth: 1,
    borderRadius: radio.l,
    padding: espacio.m,
    gap: espacio.s,
  },
  compacta: { padding: espacio.s + espacio.xs },
  fila: { flexDirection: "row", alignItems: "center" },
  periodo: { color: colores.texto, fontSize: 15, fontWeight: "600", flex: 1 },
  estado: { color: colores.ambar, fontSize: 12, fontWeight: "600" },
  estadoCerrado: { color: colores.completado },
  numeros: { flexDirection: "row", alignItems: "flex-end", gap: espacio.l },
  total: { color: colores.texto, fontSize: 44, fontWeight: "700" },
  totalCompacto: { fontSize: 32 },
  totalNota: { color: colores.textoSuave, fontSize: 12 },
  posicionCaja: { flex: 1 },
  posicion: { color: colores.texto, fontSize: 20, fontWeight: "600" },
  posicionNota: { color: colores.textoSuave, fontSize: 12 },
});
