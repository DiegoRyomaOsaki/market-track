import { type ReactNode } from "react";
import {
  type AccessibilityRole,
  StyleSheet,
  type StyleProp,
  View,
  type ViewStyle,
} from "react-native";

import { colores, espacio, radio } from "@/tema";

/**
 * El recuadro de aviso de la portada: tránsito, reportes rechazados y tiendas
 * que salieron de la ruta.
 *
 * Existe porque son tres. Los dos primeros ya eran el mismo bloque de estilos
 * con otro color de borde, y el tercero habría consolidado la copia como norma.
 *
 * Decide la CAJA —fondo, borde, padding, radio— y nada más. El color es solo el
 * borde: el significado va siempre en el texto de dentro (WCAG 1.4.1). Por eso
 * no acepta un "tipo" del que deducir un icono o un tono — quien lo usa escribe
 * lo que pasa. Y por eso tampoco impone el `gap`: la separación entre hijos es
 * del contenido, no de la caja, y no todos los avisos la quieren.
 */
export function Banner({
  color,
  rol = "summary",
  style,
  children,
}: {
  /** Color del borde. Un token de relleno/borde, no de texto. */
  color: string;
  /**
   * `summary` describe un bloque de solo lectura. Un aviso con un control
   * dentro no lo es, y el rol correcto lo sabe quien lo usa, no la caja.
   */
  rol?: AccessibilityRole;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return (
    <View
      style={[e.banner, { borderColor: color }, style]}
      accessibilityRole={rol}
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
  },
});
