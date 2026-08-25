import { StyleSheet, Text, View } from "react-native";

import { formatearPct, textoDeMiPosicion } from "@/lib/desempeno";
import { colores, espacio, radio } from "@/tema";

// El puntaje propio, en una tarjeta. Dos consumidores reales —la portada de
// "Mi día" y la pantalla de detalle—, que es lo que justifica extraerla en vez
// de duplicar el marcado.
//
// No decide nada: recibe números ya resueltos por el servidor y los pinta. La
// posición no se calcula aquí ni podría — el teléfono solo tiene su propia fila.

/**
 * La tarjeta dicha como una frase, para el lector de pantalla. Vive aquí —y no
 * repetida en cada consumidor— porque la usan la propia tarjeta y el `Pressable`
 * que la envuelve en la portada, y dos redacciones distintas del mismo dato es
 * exactamente lo que este componente existe para evitar.
 */
export function etiquetaDeDesempeno({
  etiquetaPeriodo,
  totalPct,
  puesto,
  estado,
}: {
  etiquetaPeriodo: string;
  totalPct: number | null;
  puesto: string;
  estado: string;
}): string {
  return `Mi puntaje de ${etiquetaPeriodo}: ${formatearPct(totalPct)} sobre 100. Posición: ${puesto}. Periodo ${estado.toLowerCase()}.`;
}

export function TarjetaDesempeno({
  etiquetaPeriodo,
  totalPct,
  posicion,
  evaluados,
  hayEmpate,
  cerrado,
  compacta = false,
  dentroDeUnBoton = false,
}: {
  etiquetaPeriodo: string;
  totalPct: number | null;
  posicion: number | null;
  evaluados: number | null;
  hayEmpate: boolean;
  cerrado: boolean;
  /** En la portada la tarjeta es un resumen; en su pantalla, la cabecera. */
  compacta?: boolean;
  /**
   * Cuando la tarjeta va DENTRO de un `Pressable`, cede su accesibilidad al
   * envoltorio. Dos nodos accesibles anidados se comportan distinto en TalkBack
   * y en VoiceOver: uno se traga al de dentro —y se pierden el puntaje y la
   * posición— y el otro obliga a un gesto extra para entrar en el grupo. Quien
   * envuelve compone la etiqueta con `etiquetaDeDesempeno`.
   */
  dentroDeUnBoton?: boolean;
}) {
  const puesto = textoDeMiPosicion(posicion, evaluados, hayEmpate);
  const estado = cerrado ? "Cerrado" : "En curso";

  return (
    <View
      style={[e.tarjeta, compacta && e.compacta]}
      accessible={!dentroDeUnBoton}
      accessibilityRole={dentroDeUnBoton ? undefined : "summary"}
      // Con lector de pantalla, los tres números sueltos se leen sin relación.
      // Aquí se dicen como una frase, incluido el "de N" y el estado del periodo.
      accessibilityLabel={
        dentroDeUnBoton
          ? undefined
          : etiquetaDeDesempeno({
              etiquetaPeriodo,
              totalPct,
              puesto,
              estado,
            })
      }
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
