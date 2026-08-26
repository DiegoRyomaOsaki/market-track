import { type ReactNode } from "react";
import { StyleSheet, type StyleProp, View, type ViewStyle } from "react-native";

import { colores, espacio, radio } from "@/tema";

/**
 * El recuadro de aviso de la portada: tránsito, reportes rechazados y tiendas
 * que salieron de la ruta.
 *
 * Existe porque son tres. Los dos primeros ya eran el mismo bloque de estilos
 * con otro color de borde, y el tercero habría consolidado la copia como norma.
 *
 * El color es SOLO el borde: el significado va siempre en el texto de dentro
 * (WCAG 1.4.1). Por eso el componente no acepta un "tipo" del que deducir un
 * icono o un tono — quien lo usa escribe lo que pasa.
 */
export function Banner({
  color,
  style,
  children,
}: {
  /** Color del borde. Un token de relleno/borde, no de texto. */
  color: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return (
    <View
      style={[e.banner, { borderColor: color }, style]}
      accessibilityRole="summary"
    >
      {children}
    </View>
  );
}

const e = StyleSheet.create({
  banner: {
    marginHorizontal: espacio.m,
    marginTop: espacio.s,
    paddingHorizontal: espacio.m,
    paddingVertical: espacio.s,
    borderRadius: radio.m,
    borderWidth: 1,
    backgroundColor: colores.superficie,
    gap: espacio.xs,
  },
});
